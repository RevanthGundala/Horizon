import { getWeather, weatherTool } from './weather';
import { searchKnowledgeBase, knowledgeBaseTool } from './knowledge-base';

// Export all tool implementations
export {
  getWeather,
  searchKnowledgeBase,
};

// Export all tool definitions
export const availableTools = [
  weatherTool,
  knowledgeBaseTool,
];

// Define the tool registry type
export interface ToolRegistry {
  [key: string]: (...args: any[]) => Promise<any>;
}

// Tool execution registry
export const toolRegistry: ToolRegistry = {
  get_weather: getWeather,
  search_knowledge_base: searchKnowledgeBase,
};
