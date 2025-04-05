/**
 * User Info tool - Gets information about the authenticated user
 * 
 * @param userId The user ID
 * @returns User information
 */
export async function getUserInfo(userId: string): Promise<any> {
  // In a real implementation, you would fetch user data from your database
  return {
    userId,
    name: "Example User",
    preferences: {
      theme: "dark",
      language: "en",
    },
    lastActive: new Date().toISOString(),
  };
}

export const userInfoTool = {
  type: "function",
  function: {
    name: "get_user_info",
    description: "Get information about the currently authenticated user",
    parameters: {
      type: "object",
      properties: {},
      required: [],
    },
  },
};
