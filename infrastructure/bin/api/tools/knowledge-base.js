"use strict";
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.knowledgeBaseTool = void 0;
exports.searchKnowledgeBase = searchKnowledgeBase;
/**
 * Knowledge Base tool - Searches a knowledge base for information
 *
 * @param query The search query
 * @returns Search results
 */
function searchKnowledgeBase(query) {
    return __awaiter(this, void 0, void 0, function* () {
        // In a real implementation, you would search a knowledge base
        return {
            query,
            results: [
                {
                    title: "Example Result 1",
                    snippet: "This is a sample result that matches the query.",
                    url: "https://example.com/result1",
                },
                {
                    title: "Example Result 2",
                    snippet: "Another sample result for demonstration purposes.",
                    url: "https://example.com/result2",
                },
            ],
        };
    });
}
exports.knowledgeBaseTool = {
    type: "function",
    function: {
        name: "search_knowledge_base",
        description: "Search the knowledge base for information on a topic",
        parameters: {
            type: "object",
            properties: {
                query: {
                    type: "string",
                    description: "The search query to find information about",
                },
            },
            required: ["query"],
        },
    },
};
//# sourceMappingURL=knowledge-base.js.map