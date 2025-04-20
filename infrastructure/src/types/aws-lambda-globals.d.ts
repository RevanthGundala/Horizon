// In a .d.ts file (e.g., src/types/aws-lambda-globals.d.ts)
import { Context } from 'aws-lambda';
import { Writable } from 'stream'; // Import Writable from Node.js stream

// Declare the global namespace/object provided by the Lambda runtime for streaming
declare global {
  namespace awslambda {
    /**
     * Wraps a streaming function handler to enable response streaming.
     * @param handler The function handler implementing the streaming logic.
     */
    function streamifyResponse<TEvent = any>(
      handler: (
        event: TEvent,
        responseStream: Writable, // Use Node.js Writable stream type
        context: Context
      ) => Promise<void> | void
    ): (event: TEvent, context: Context) => Promise<any>; // The wrapped handler signature might vary slightly, often simplified
  }
}

// You might need to add an empty export to make this file a module
// if it doesn't contain any imports/exports already.
export {};