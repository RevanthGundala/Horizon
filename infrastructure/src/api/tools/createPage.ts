import { tool } from 'ai';
import { z } from 'zod';
import { createPage as createPageLambda, updatePage as updatePageLambda } from '../lambdas/notes';
import { createBlock } from '../lambdas/blocks';

async function createPage(title: string, content: string, userId: string): Promise<string> {
  try {
    // Create the page
    const pageResponse = await createPageLambda({
      body: JSON.stringify({ title }),
      requestContext: { authorizer: { userId } }
    } as any);
    
    if (pageResponse.statusCode !== 200) {
      throw new Error(pageResponse.body);
    }
    
    const page = JSON.parse(pageResponse.body).page;
    
    // Create initial content block
    const blockResponse = await createBlock({
      body: JSON.stringify({
        pageId: page.id,
        type: 'paragraph',
        content,
        orderIndex: 0
      }),
      requestContext: { authorizer: { userId } }
    } as any);
    
    if (blockResponse.statusCode !== 200) {
      throw new Error(blockResponse.body);
    }
    
    return `Page "${title}" created successfully! (ID: ${page.id})`;
  } catch (error) {
    console.error('Error in createPage:', error);
    return `Sorry, there was an error creating the page.`;
  }
}

export const createPageTool = (userId: string) => tool({
  description: "Create a new page in your workspace.",
  parameters: z.object({
    title: z.string().describe("The title of the page."),
    content: z.string().describe("The initial content of the page."),
  }),
  execute: async ({ title, content }) => {
    return createPage(title, content, userId);
  },
});
