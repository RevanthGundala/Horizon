const fs = require('fs');
const { execSync } = require('child_process');
const path = require('path');

// Get app environment from Pulumi config or default to 'development'
let appEnv = 'development';
try {
  appEnv = execSync('pulumi config get horizon-infrastructure:APP_ENV', { encoding: 'utf8' }).trim();
  console.log(`Using environment: ${appEnv}`);
} catch (error) {
  console.log(`No APP_ENV found in Pulumi config, defaulting to ${appEnv}`);
}

// Path to .env file (one directory up from infrastructure)
const rootDir = path.join(__dirname, '..');
const envFilePath = path.join(rootDir, `.env.${appEnv}`);

// List of public config keys that should be exposed to the frontend with VITE_ prefix
const publicConfigKeys = [
  'API_URL',
  'AUTH_CALLBACK_URL',
  'WORKOS_CLIENT_ID'
];

try {
  // Run pulumi stack output to get all outputs
  const outputs = {};
  
  // Get API endpoint
  try {
    outputs.API_URL = execSync('pulumi stack output apiEndpoint', { encoding: 'utf8' }).trim();
    console.log(`Retrieved API endpoint: ${outputs.API_URL}`);
    
    // Remove trailing slash if present to avoid double slash in URLs
    outputs.API_URL = outputs.API_URL.endsWith('/') 
      ? outputs.API_URL.slice(0, -1) 
      : outputs.API_URL;
  } catch (error) {
    console.log('API endpoint not found in Pulumi outputs');
  }
  
  // Get other outputs from Pulumi
  for (const key of publicConfigKeys) {
    if (key !== 'API_URL') { // Already handled above
      try {
        const value = execSync(`pulumi config get horizon-infrastructure:${key}`, { encoding: 'utf8' }).trim();
        outputs[key] = value;
        console.log(`Retrieved ${key}: ${value}`);
      } catch (error) {
        console.log(`${key} not found in Pulumi config`);
      }
    }
  }
  
  // Create or update the environment file
  let envContent = '';
  try {
    // Try to read existing file
    envContent = fs.readFileSync(envFilePath, 'utf8');
    console.log(`Existing .env.${appEnv} file found, updating...`);
  } catch (err) {
    console.log(`No existing .env.${appEnv} file found, creating a new one`);
  }
  
  // Update environment variables
  for (const [key, value] of Object.entries(outputs)) {
    if (!value) continue;
    
    // Add VITE_ prefix for frontend variables
    const envKey = `VITE_${key}`;
    const regex = new RegExp(`${envKey}=.*`);
    const newEnvVar = `${envKey}="${value}"`;
    
    if (regex.test(envContent)) {
      // Replace existing entry
      envContent = envContent.replace(regex, newEnvVar);
    } else {
      // Add new entry
      envContent += envContent ? `\n${newEnvVar}` : newEnvVar;
    }
    
    console.log(`Updated ${envKey} with value: ${value}`);
  }
  
  // Write back to .env file
  fs.writeFileSync(envFilePath, envContent);
  console.log(`Updated .env.${appEnv} file with ${Object.keys(outputs).length} variables`);
  
  // Also update Pulumi configuration for any values that came from outputs
  console.log('Updating Pulumi configuration...');
  for (const [key, value] of Object.entries(outputs)) {
    if (!value) continue;
    
    // Update in Pulumi config
    execSync(`pulumi config set horizon-infrastructure:${key} ${value}`, { 
      stdio: 'inherit' 
    });
  }
  
  console.log('Environment update complete!');
} catch (error) {
  console.error('Error updating environment variables:', error);
  process.exit(1);
}
