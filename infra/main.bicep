// LedgerLens — Phase 7 Step 2b infrastructure (ADR-0011, spec 0007).
//
// Azure Container Apps: web (external ingress) + api (internal ingress), Azure
// Database for PostgreSQL Flexible Server (managed, TLS-enforced), ACR, ACA secrets.
// App Insights / OpenTelemetry instrumentation is deferred to 2d — the Log Analytics
// workspace here is only the ACA environment's operational log sink.
//
// Deployed in TWO passes via `deployApps` (see deploy.sh): pass 1 (false) provisions
// ACR + Postgres + the environment so images can be pushed; pass 2 (true) deploys the
// apps + the migrate job once the images exist in ACR.

targetScope = 'resourceGroup'

@description('Azure region for all resources.')
param location string = 'canadacentral'

@description('Short prefix for resource names.')
param namePrefix string = 'ledgerlens'

@description('PostgreSQL administrator login.')
param postgresAdminUser string = 'lladmin'

@description('PostgreSQL administrator password (server-side secret).')
@secure()
param postgresAdminPassword string

@description('Container image tag (e.g. the git SHA) for both apps.')
param imageTag string = 'latest'

@description('Pass 2 toggle: deploy the container apps + migrate job. Pass 1 leaves this false so images can be pushed to ACR first.')
param deployApps bool = false

@description('Full DATABASE_URL incl. ?sslmode=require — server-side secret, only used when deployApps=true.')
@secure()
param databaseUrl string = ''

@description('Anthropic API key — server-side secret, only used when deployApps=true.')
@secure()
param anthropicApiKey string = ''

var tags = {
  project: 'ledgerlens'
  phase: '7'
  managedBy: 'bicep'
}
var acrName = toLower(replace('${namePrefix}acr${uniqueString(resourceGroup().id)}', '-', ''))
var pgServerName = toLower('${namePrefix}-pg-${uniqueString(resourceGroup().id)}')
var apiAppName = '${namePrefix}-api'
var webAppName = '${namePrefix}-web'
var dbName = 'ledgerlens'

// --- Log Analytics (required by the ACA environment for container logs; this is
//     operational logging, NOT the App Insights APM deferred to 2d). ---
resource law 'Microsoft.OperationalInsights/workspaces@2023-09-01' = {
  name: '${namePrefix}-law'
  location: location
  tags: tags
  properties: {
    sku: { name: 'PerGB2018' }
    retentionInDays: 30
  }
}

// --- Azure Container Registry (Basic; admin creds for the first deploy —
//     managed-identity acrPull is the 2d hardening follow-up). ---
resource acr 'Microsoft.ContainerRegistry/registries@2023-11-01-preview' = {
  name: acrName
  location: location
  tags: tags
  sku: { name: 'Basic' }
  properties: {
    adminUserEnabled: true
  }
}

// --- PostgreSQL Flexible Server (Burstable B1ms, smallest storage; TLS enforced by
//     default via require_secure_transport=on). ---
resource pg 'Microsoft.DBforPostgreSQL/flexibleServers@2024-08-01' = {
  name: pgServerName
  location: location
  tags: tags
  sku: {
    name: 'Standard_B1ms'
    tier: 'Burstable'
  }
  properties: {
    version: '16'
    administratorLogin: postgresAdminUser
    administratorLoginPassword: postgresAdminPassword
    storage: { storageSizeGB: 32 }
    backup: { backupRetentionDays: 7, geoRedundantBackup: 'Disabled' }
    highAvailability: { mode: 'Disabled' }
  }
}

resource pgDb 'Microsoft.DBforPostgreSQL/flexibleServers/databases@2024-08-01' = {
  parent: pg
  name: dbName
}

// Allow Azure-internal services (incl. the ACA environment's egress) to reach the
// server. The 0.0.0.0 rule is Azure's "allow Azure services", not the public internet.
resource pgAllowAzure 'Microsoft.DBforPostgreSQL/flexibleServers/firewallRules@2024-08-01' = {
  parent: pg
  name: 'AllowAllAzureServicesAndResources'
  properties: { startIpAddress: '0.0.0.0', endIpAddress: '0.0.0.0' }
}

// --- ACA managed environment ---
resource env 'Microsoft.App/managedEnvironments@2024-03-01' = {
  name: '${namePrefix}-env'
  location: location
  tags: tags
  properties: {
    appLogsConfiguration: {
      destination: 'log-analytics'
      logAnalyticsConfiguration: {
        customerId: law.properties.customerId
        sharedKey: law.listKeys().primarySharedKey
      }
    }
  }
}

var registryServer = acr.properties.loginServer

// Common registry block (admin creds via a secret) shared by both apps + the job.
var registries = [
  {
    server: registryServer
    username: acr.listCredentials().username
    passwordSecretRef: 'acr-password'
  }
]
var acrSecret = {
  name: 'acr-password'
  value: acr.listCredentials().passwords[0].value
}

// --- api container app: INTERNAL ingress (only the web app reaches it) ---
resource apiApp 'Microsoft.App/containerApps@2024-03-01' = if (deployApps) {
  name: apiAppName
  location: location
  tags: tags
  dependsOn: [pgAllowAzure]
  properties: {
    managedEnvironmentId: env.id
    configuration: {
      activeRevisionsMode: 'Single'
      ingress: {
        external: false
        targetPort: 3001
        transport: 'auto'
        allowInsecure: false
      }
      registries: registries
      secrets: [
        acrSecret
        { name: 'database-url', value: databaseUrl }
        { name: 'anthropic-api-key', value: anthropicApiKey }
      ]
    }
    template: {
      containers: [
        {
          name: 'api'
          image: '${registryServer}/${namePrefix}-api:${imageTag}'
          resources: { cpu: json('1.0'), memory: '2.0Gi' }
          env: [
            { name: 'NODE_ENV', value: 'production' }
            { name: 'PORT', value: '3001' }
            { name: 'DATABASE_URL', secretRef: 'database-url' }
            { name: 'ANTHROPIC_API_KEY', secretRef: 'anthropic-api-key' }
          ]
          probes: [
            {
              // Generous startup grace: the ~600MB binary-dominated image is slow to
              // boot from scale-to-zero (ADR-0012); don't let liveness kill it early.
              type: 'Startup'
              httpGet: { path: '/health', port: 3001 }
              initialDelaySeconds: 5
              periodSeconds: 10
              failureThreshold: 30
            }
            {
              type: 'Liveness'
              httpGet: { path: '/health', port: 3001 }
              initialDelaySeconds: 10
              periodSeconds: 30
            }
            {
              type: 'Readiness'
              httpGet: { path: '/health', port: 3001 }
              initialDelaySeconds: 5
              periodSeconds: 10
            }
          ]
        }
      ]
      scale: { minReplicas: 0, maxReplicas: 2 }
    }
  }
}

// --- web container app: EXTERNAL ingress (the only public surface) ---
resource webApp 'Microsoft.App/containerApps@2024-03-01' = if (deployApps) {
  name: webAppName
  location: location
  tags: tags
  properties: {
    managedEnvironmentId: env.id
    configuration: {
      activeRevisionsMode: 'Single'
      ingress: {
        external: true
        targetPort: 3000
        transport: 'auto'
        allowInsecure: false
      }
      registries: registries
      secrets: [acrSecret]
    }
    template: {
      containers: [
        {
          name: 'web'
          image: '${registryServer}/${namePrefix}-web:${imageTag}'
          resources: { cpu: json('0.5'), memory: '1.0Gi' }
          env: [
            { name: 'NODE_ENV', value: 'production' }
            { name: 'PORT', value: '3000' }
            { name: 'HOSTNAME', value: '0.0.0.0' }
          ]
        }
      ]
      scale: { minReplicas: 0, maxReplicas: 2 }
    }
  }
}

// --- migrate/seed/verify job: manual trigger, fail-closed (no retries) ---
resource migrateJob 'Microsoft.App/jobs@2024-03-01' = if (deployApps) {
  name: '${namePrefix}-migrate'
  location: location
  tags: tags
  dependsOn: [pgAllowAzure]
  properties: {
    environmentId: env.id
    configuration: {
      triggerType: 'Manual'
      replicaTimeout: 900
      replicaRetryLimit: 0
      manualTriggerConfig: { parallelism: 1, replicaCompletionCount: 1 }
      registries: registries
      secrets: [
        acrSecret
        { name: 'database-url', value: databaseUrl }
      ]
    }
    template: {
      containers: [
        {
          name: 'migrate'
          image: '${registryServer}/${namePrefix}-api:${imageTag}'
          resources: { cpu: json('0.5'), memory: '1.0Gi' }
          env: [{ name: 'DATABASE_URL', secretRef: 'database-url' }]
          command: ['sh', '-c']
          args: [
            'node --conditions=ledgerlens-dist /app/node_modules/@ledger-lens/db/dist/migrate.js && node --conditions=ledgerlens-dist /app/node_modules/@ledger-lens/db/dist/demo-seed.js && node --conditions=ledgerlens-dist /app/node_modules/@ledger-lens/db/dist/verify-seed.js'
          ]
        }
      ]
    }
  }
}

output acrName string = acr.name
output acrLoginServer string = acr.properties.loginServer
output envDefaultDomain string = env.properties.defaultDomain
output pgFqdn string = pg.properties.fullyQualifiedDomainName
output apiInternalFqdn string = apiApp.?properties.configuration.ingress.fqdn ?? ''
output webFqdn string = webApp.?properties.configuration.ingress.fqdn ?? ''
