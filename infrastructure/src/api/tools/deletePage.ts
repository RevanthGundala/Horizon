import { tool } from 'ai';
import { z } from 'zod';
import { deletePage as deletePageLambda } from '../lambdas/notes';

async function deletePage(pageId: string, userId: string): Promise<string> {
  try {
    const response = await deletePageLambda({
      pathParameters: { id: pageId },
      requestContext: { authorizer: { userId } }
    } as any);
    
    if (response.statusCode !== 200) {
      throw new Error(response.body);
    }
    
    return `Page deleted successfully.`;
  } catch (error) {
    console.error('Error in deletePage:', error);
    return `Sorry, there was an error deleting the page.`;
  }
}

export const deletePageTool = (userId: string) => tool({
  description: "Delete a page from your workspace.",
  parameters: z.object({
    pageId: z.string().describe("The ID of the page to delete."),
  }),
  execute: async ({ pageId }) => {
    return deletePage(pageId, userId);
  },
});
