"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.toolRegistry = exports.availableTools = exports.searchKnowledgeBase = exports.getWeather = void 0;
const weather_1 = require("./weather");
Object.defineProperty(exports, "getWeather", { enumerable: true, get: function () { return weather_1.getWeather; } });
const knowledge_base_1 = require("./knowledge-base");
Object.defineProperty(exports, "searchKnowledgeBase", { enumerable: true, get: function () { return knowledge_base_1.searchKnowledgeBase; } });
// Export all tool definitions
exports.availableTools = [
    weather_1.weatherTool,
    knowledge_base_1.knowledgeBaseTool,
];
// Tool execution registry
exports.toolRegistry = {
    get_weather: weather_1.getWeather,
    search_knowledge_base: knowledge_base_1.searchKnowledgeBase,
};
//# sourceMappingURL=index.js.map