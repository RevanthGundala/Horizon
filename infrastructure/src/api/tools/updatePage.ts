import { tool } from 'ai';
import { z } from 'zod';
import { updatePage as updatePageLambda } from '../lambdas/pages';

async function updatePage(pageId: string, newContent: string, userId: string): Promise<string> {
  try {
    const response = await updatePageLambda({
      pathParameters: { id: pageId },
      body: JSON.stringify({ content: newContent }),
      requestContext: { authorizer: { userId } }
    } as any);
    
    if (response.statusCode !== 200) {
      throw new Error(response.body);
    }
    
    return `Page updated successfully!`;
  } catch (error) {
    console.error('Error in updatePage:', error);
    return `Sorry, there was an error updating the page.`;
  }
}

export const updatePageTool = (userId: string) => tool({
  description: "Update an existing page in your workspace.",
  parameters: z.object({
    pageId: z.string().describe("The ID of the page to update."),
    content: z.string().describe("The new content for the page."),
  }),
  execute: async ({ pageId, content }) => {
    return updatePage(pageId, content, userId);
  },
});
