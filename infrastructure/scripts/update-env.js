const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

// Get app environment from Pulumi config or default to 'development'
let appEnv = 'development';
try {
  appEnv = execSync('pulumi config get horizon-infrastructure:APP_ENV', { encoding: 'utf8' }).trim();
console.log(`Using environment: ${appEnv}`);

// Path to project root
const projectRoot = path.join(__dirname, '../..');

// Paths for both .env files
const viteEnvFilePath = path.join(projectRoot, `.env.${appEnv}`);
const electronEnvFilePath = path.join(projectRoot, 'electron', `.env.${appEnv}`);

// Mapping for output keys to environment variable names
const outputKeyMapping = {
  apiGatewayEndpoint: 'API_URL',
  chatFunctionUrlEndpoint: 'CHAT_URL'
};

// List of public config keys that should be exposed to the frontend with VITE_ prefix
const publicConfigKeys = [
  'API_URL',
  'CHAT_URL', 
  'WORKOS_CLIENT_ID'
];

// Collect environment outputs
const outputs = {};

// Function to write environment file
const writeEnvFile = (filePath, isVite = false) => {
  const envContent = Object.entries(outputs)
    .map(([key, value]) => {
      // If it's the Vite file, prepend VITE_ to specified keys
      const envKey = isVite && publicConfigKeys.includes(key) 
        ? `VITE_${key}` 
        : key;
      return `${envKey}="${value}"`;
    })
    .join('\n');

  try {
    fs.writeFileSync(filePath, envContent);
    console.log(`Updated ${path.basename(filePath)} file`);
  } catch (error) {
    console.error(`Error writing to ${filePath}:`, error);
  }
};


  // Get API endpoint
  outputs[outputKeyMapping.apiGatewayEndpoint] = execSync('pulumi stack output apiGatewayEndpoint', { encoding: 'utf8' }).trim();
  console.log(`Retrieved API endpoint: ${outputs[outputKeyMapping.apiGatewayEndpoint]}`);

  // Get Chat Function URL endpoint
  outputs[outputKeyMapping.chatFunctionUrlEndpoint] = execSync('pulumi stack output chatFunctionUrlEndpoint', { encoding: 'utf8' }).trim();
  console.log(`Retrieved Chat Function URL: ${outputs[outputKeyMapping.chatFunctionUrlEndpoint]}`);

  // Get other Pulumi config values
  for (const key of publicConfigKeys) {
    if (key !== 'API_URL' && key !== 'CHAT_URL') {
      try {
        const value = execSync(`pulumi config get horizon-infrastructure:${key}`, { encoding: 'utf8' }).trim();
        outputs[key] = value;
        console.log(`Retrieved ${key}: ${value}`);
      } catch (configError) {
        console.log(`${key} not found in Pulumi config`);
      }
    }
  }

  // Write both environment files
  writeEnvFile(viteEnvFilePath, true);   // Vite file with VITE_ prefix
  writeEnvFile(electronEnvFilePath);     // Electron file without prefix

  console.log('Environment update complete!');
} catch (error) {
  console.error('Error updating environment variables:', error);
  process.exit(1);
}

