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
exports.weatherTool = void 0;
exports.getWeather = getWeather;
/**
 * Weather tool - Gets weather information for a location
 *
 * @param location The location to get weather for
 * @returns Weather information
 */
function getWeather(location) {
    return __awaiter(this, void 0, void 0, function* () {
        // In a real implementation, you would call a weather API
        return {
            location,
            temperature: 72,
            conditions: "Sunny",
            humidity: 45,
            timestamp: new Date().toISOString(),
        };
    });
}
exports.weatherTool = {
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
//# sourceMappingURL=weather.js.map