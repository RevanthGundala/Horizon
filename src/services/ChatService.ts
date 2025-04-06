// ChatService.ts - Service to handle API calls to the chat endpoint

// Define the message interface
interface ChatMessage {
  role: string;
  content: string;
}

// Define the chat request interface
interface ChatRequest {
  messages: ChatMessage[];
  stream?: boolean;
  model?: string;
  temperature?: number;
  max_tokens?: number;
}

// Define the chat response interface
interface ChatResponse {
  id: string;
  object: string;
  created: number;
  model: string;
  choices: {
    index: number;
    message: ChatMessage;
    finish_reason: string;
  }[];
}

/**
 * Service to handle chat API calls
 */
class ChatService {
  private apiUrl: string;
  private mockEnabled: boolean = true; // Enable mock mode

  constructor() {
    // Get the API URL from environment variables
    const apiBaseUrl = import.meta.env.VITE_API_URL || '';
    this.apiUrl = `${apiBaseUrl}/chat`;
    console.log('Chat API URL:', this.apiUrl);
  }

  /**
   * Send a query to the chat API
   * @param query The user's search query
   * @returns Promise with the chat response
   */
  async sendQuery(query: string): Promise<ChatResponse> {
    try {
      // Create a chat request with the user's query
      const chatRequest: ChatRequest = {
        messages: [
          { role: 'system', content: 'You are a helpful assistant.' },
          { role: 'user', content: query }
        ],
        stream: false,
        temperature: 0.7,
        max_tokens: 1000
      };

      // If mock is enabled, return a mock response
      if (this.mockEnabled) {
        console.log('Using mock response for query:', query);
        return this.getMockResponse(query);
      }

      console.log('Sending request to:', this.apiUrl);
      
      // Make the API call
      const response = await fetch(this.apiUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(chatRequest)
      });

      if (!response.ok) {
        throw new Error(`API call failed with status: ${response.status}`);
      }

      return await response.json();
    } catch (error) {
      console.error('Error sending chat query:', error);
      
      // If there's an error and mock is enabled, return a mock response
      if (this.mockEnabled) {
        console.log('Falling back to mock response due to error');
        return this.getMockResponse(query);
      }
      
      throw error;
    }
  }

  /**
   * Generate a mock response for the given query
   * @param query The user's query
   * @returns A mock ChatResponse
   */
  private getMockResponse(query: string): Promise<ChatResponse> {
    // Simulate a delay to mimic network request
    return new Promise<ChatResponse>((resolve) => {
      setTimeout(() => {
        const response: ChatResponse = {
          id: `mock-${Date.now()}`,
          object: 'chat.completion',
          created: Math.floor(Date.now() / 1000),
          model: 'mock-model',
          choices: [
            {
              index: 0,
              message: {
                role: 'assistant',
                content: this.generateMockResponseContent(query)
              },
              finish_reason: 'stop'
            }
          ]
        };
        resolve(response);
      }, 1000); // 1 second delay
    });
  }

  /**
   * Generate content for the mock response based on the query
   * @param query The user's query
   * @returns Generated response content
   */
  private generateMockResponseContent(query: string): string {
    const lowerQuery = query.toLowerCase();
    
    // Weather-related queries
    if (lowerQuery.includes('weather') || lowerQuery.includes('temperature') || lowerQuery.includes('forecast')) {
      return `The current weather in ${lowerQuery.includes('in') ? query.split('in')[1].trim() : 'your area'} is sunny with a temperature of 72°F (22°C). The forecast for the next few days shows clear skies with temperatures ranging from 68°F to 75°F.`;
    }
    
    // Time-related queries
    if (lowerQuery.includes('time') || lowerQuery.includes('date') || lowerQuery.includes('day')) {
      const now = new Date();
      return `The current time is ${now.toLocaleTimeString()} on ${now.toLocaleDateString()}.`;
    }
    
    // Help-related queries
    if (lowerQuery.includes('help') || lowerQuery.includes('assist') || lowerQuery.includes('support')) {
      return `I'm here to help! You can ask me about the weather, time, or any general questions. I can also help you with tasks, information, or just have a conversation.`;
    }
    
    // General knowledge
    if (lowerQuery.includes('who') || lowerQuery.includes('what') || lowerQuery.includes('where') || 
        lowerQuery.includes('when') || lowerQuery.includes('why') || lowerQuery.includes('how')) {
      return `That's an interesting question about "${query}". While I don't have access to real-time information, I can tell you that this is a simulated response for demonstration purposes. In a real application, this would connect to an AI service to provide accurate answers.`;
    }
    
    // Default response
    return `Thank you for your message: "${query}". This is a simulated response for demonstration purposes. In a real application, this would connect to an AI service like Fireworks AI to provide more helpful and contextual responses.`;
  }
}

// Export a singleton instance
export const chatService = new ChatService();
