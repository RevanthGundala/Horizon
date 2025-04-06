import { Readable } from 'stream';
import axios from 'axios';

/**
 * Creates a readable stream from a Fireworks AI streaming response
 * @param url The Fireworks API endpoint URL
 * @param payload The request payload
 * @param apiKey The Fireworks API key
 * @returns A readable stream of the response data
 */
export function createFireworksStream(
  url: string,
  payload: any,
  apiKey: string
): Readable {
  // Create a readable stream that will be returned to the client
  const stream = new Readable({
    read() {} // No-op implementation required for Readable streams
  });

  // Make the streaming request to Fireworks AI
  axios({
    method: 'post',
    url,
    data: payload,
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
      'Accept': 'text/event-stream'
    },
    responseType: 'stream'
  }).then(response => {
    // Process the stream data
    let buffer = '';
    
    response.data.on('data', (chunk: Buffer) => {
      // Convert chunk to string and add to buffer
      buffer += chunk.toString();
      
      // Process complete SSE messages
      const lines = buffer.split('\n\n');
      buffer = lines.pop() || ''; // Keep the last incomplete chunk in the buffer
      
      // Process each complete message
      lines.forEach(line => {
        if (line.trim() === '') return;
        
        // Format as SSE
        if (line.startsWith('data: ')) {
          const data = line.substring(6);
          if (data === '[DONE]') {
            stream.push('data: [DONE]\n\n');
          } else {
            try {
              const parsed = JSON.parse(data);
              stream.push(`data: ${JSON.stringify(parsed)}\n\n`);
            } catch (e) {
              console.error('Error parsing JSON from Fireworks:', e);
              stream.push(`data: ${data}\n\n`);
            }
          }
        } else {
          stream.push(`data: ${line}\n\n`);
        }
      });
    });
    
    response.data.on('end', () => {
      // Process any remaining data in the buffer
      if (buffer.trim() !== '') {
        if (buffer.startsWith('data: ')) {
          const data = buffer.substring(6);
          if (data !== '[DONE]') {
            try {
              const parsed = JSON.parse(data);
              stream.push(`data: ${JSON.stringify(parsed)}\n\n`);
            } catch (e) {
              console.error('Error parsing JSON from Fireworks:', e);
              stream.push(`data: ${data}\n\n`);
            }
          }
        } else {
          stream.push(`data: ${buffer}\n\n`);
        }
      }
      
      // End the stream
      stream.push('data: [DONE]\n\n');
      stream.push(null);
    });
    
    response.data.on('error', (err: Error) => {
      console.error('Error in Fireworks stream:', err);
      stream.push(`data: ${JSON.stringify({ error: err.message })}\n\n`);
      stream.push(null);
    });
  }).catch(error => {
    console.error('Error making request to Fireworks:', error);
    stream.push(`data: ${JSON.stringify({ error: error.message })}\n\n`);
    stream.push(null);
  });
  
  return stream;
}

/**
 * Converts a readable stream to a string for AWS Lambda response
 * @param stream The readable stream
 * @returns Promise that resolves to a string
 */
export function streamToString(stream: Readable): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    stream.on('data', (chunk) => chunks.push(Buffer.from(chunk)));
    stream.on('error', reject);
    stream.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
  });
}
