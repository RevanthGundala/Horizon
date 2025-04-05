const fs = require('fs');
const { execSync } = require('child_process');
const path = require('path');

// Path to .env file (one directory up from infrastructure)
const envFilePath = path.join(__dirname, '..', '.env');

try {
  // Run pulumi stack output to get the API endpoint
  const apiEndpoint = execSync('pulumi stack output apiEndpoint', { encoding: 'utf8' }).trim();
  console.log(`Retrieved API endpoint: ${apiEndpoint}`);

  // Remove trailing slash if present to avoid double slash in URLs
  const cleanApiEndpoint = apiEndpoint.endsWith('/') ? apiEndpoint.slice(0, -1) : apiEndpoint;
  console.log(`Cleaned API endpoint: ${cleanApiEndpoint}`);

  // Read the current .env file
  let envContent = '';
  try {
    envContent = fs.readFileSync(envFilePath, 'utf8');
  } catch (err) {
    console.log('No existing .env file found, creating a new one');
  }

  // Update or add the VITE_API_URL
  const regex = /VITE_API_URL=.*/;
  const newEnvVar = `VITE_API_URL="${cleanApiEndpoint}"`;
  
  if (regex.test(envContent)) {
    // Replace existing entry
    envContent = envContent.replace(regex, newEnvVar);
  } else {
    // Add new entry
    envContent += `\n${newEnvVar}`;
  }

  // Write back to .env file
  fs.writeFileSync(envFilePath, envContent);
  console.log(`Updated .env file with API endpoint: ${cleanApiEndpoint}`);
} catch (error) {
  console.error('Error updating .env file:', error.message);
  process.exit(1);
}
