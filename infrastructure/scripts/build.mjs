// build.mjs (save this in the root of your project, next to package.json)
import esbuild from 'esbuild';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// --- Configuration ---
const lambdaSourceDir = path.join(__dirname, '../src', 'api', 'lambdas'); // Adjust if your handlers are elsewhere
const outputDir = path.join(__dirname, '../dist');

// --- Find all .ts files in the source directory ---
// Assumes each .ts file in lambdaSourceDir is a handler entry point
const entryPoints = fs.readdirSync(lambdaSourceDir)
    .filter(file => file.endsWith('.ts'))
    .map(file => path.join(lambdaSourceDir, file));

if (entryPoints.length === 0) {
    console.error(`No TypeScript entry points found in ${lambdaSourceDir}`);
    process.exit(1);
}

console.log('Building entry points:', entryPoints);
console.log('Output directory:', outputDir);

// --- Run esbuild ---
esbuild.build({
    entryPoints: entryPoints,
    bundle: true,           // Bundle dependencies
    platform: 'node',       // Target Node.js environment
    target: 'node18',     // Match your AWS Lambda runtime (e.g., node18.x)
    format: 'cjs',          // Output CommonJS modules (standard for most Lambda handlers)
    outdir: outputDir,      // Output directory ('dist')
    sourcemap: true,        // Generate sourcemaps for easier debugging
    external: [],           // Ensure dependencies are bundled, don't mark them as external
    // external: ['pg-native'], // Example: If a specific dependency CANNOT be bundled (like some native ones)
    minify: false,          // Optional: Set to true to minify output
    logLevel: 'info',       // Show build information
}).then(() => {
    console.log('esbuild complete.');
}).catch((err) => {
    console.error('esbuild failed:', err);
    process.exit(1);
});