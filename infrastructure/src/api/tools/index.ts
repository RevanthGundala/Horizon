import { getWeather, weatherTool } from './weather';
import { searchKnowledgeBase, knowledgeBaseTool } from './knowledge-base';
import { getUserInfo, userInfoTool } from './user-info';

// Export all tool implementations
export {
  getWeather,
  searchKnowledgeBase,
  getUserInfo
};

// Export all tool definitions
export const availableTools = [
  weatherTool,
  knowledgeBaseTool,
  userInfoTool
];

// Define the tool registry type
export interface ToolRegistry {
  [key: string]: (...args: any[]) => Promise<any>;
}

// Tool execution registry
export const toolRegistry: ToolRegistry = {
  get_weather: getWeather,
  search_knowledge_base: searchKnowledgeBase,
  get_user_info: getUserInfo
};
