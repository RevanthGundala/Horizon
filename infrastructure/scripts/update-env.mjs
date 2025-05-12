import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { execSync } from 'child_process';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

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
  cloudfrontDomain: 'API_URL',
};

// List of public config keys that should be exposed to the frontend with VITE_ prefix
const publicConfigKeys = [
  'API_URL',
  'FRONTEND_URL',
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


  // Get CloudFront domain and set as API_URL
  const cloudfrontDomain = execSync('pulumi stack output cloudfrontDomain', { encoding: 'utf8' }).trim();
  outputs[outputKeyMapping.cloudfrontDomain] = `https://${cloudfrontDomain}`;
  console.log(`Retrieved CloudFront domain: ${outputs[outputKeyMapping.cloudfrontDomain]}`);

  // Get other Pulumi config values
  for (const key of publicConfigKeys) {
    // Skip API_URL since it's set via cloudfrontDomain output
    if (key !== 'API_URL') {
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
