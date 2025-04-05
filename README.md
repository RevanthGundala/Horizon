# Horizon

An Electron.js application built with Vite, React, and TypeScript.

## Project Structure

- `/src` - React application source code
- `/electron` - Electron main process code
- `/dist` - Build output directory

## Development

### Prerequisites

- Node.js (v14 or higher)
- npm or yarn

### Installation

```bash
npm install
```

### Development Mode

To run the application in development mode:

```bash
npm run electron:dev
```

This will start both the Vite dev server and the Electron application.

### Building for Production

To build the application for production:

```bash
npm run electron:package
```

This will create a packaged application in the `/release` directory.

## Scripts

- `npm run dev` - Start Vite development server
- `npm run build` - Build the React application
- `npm run electron:dev` - Run the application in development mode
- `npm run electron:build` - Build both React and Electron parts
- `npm run electron:start` - Start Electron with the built application
- `npm run electron:package` - Package the application for distribution
# Horizon
# Horizon
