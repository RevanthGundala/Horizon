/**
 * Weather tool - Gets weather information for a location
 * 
 * @param location The location to get weather for
 * @returns Weather information
 */
export async function getWeather(location: string): Promise<any> {
  // In a real implementation, you would call a weather API
  return {
    location,
    temperature: 72,
    conditions: "Sunny",
    humidity: 45,
    timestamp: new Date().toISOString(),
  };
}

export const weatherTool = {
  type: "function",
  function: {
    name: "get_weather",
    description: "Get current weather information for a location",
    parameters: {
      type: "object",
      properties: {
        location: {
          type: "string",
          description: "The city and state, e.g. San Francisco, CA or the ZIP code",
        },
      },
      required: ["location"],
    },
  },
};
