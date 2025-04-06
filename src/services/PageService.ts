import { User } from '../context/AuthContext';

export interface Page {
  id: string;
  user_id: string;
  title: string;
  icon?: string;
  parent_id?: string;
  created_at: string;
  updated_at: string;
}

class PageService {
  private apiUrl: string;

  constructor() {
    this.apiUrl = import.meta.env.VITE_API_URL || '';
  }

  /**
   * Fetch all pages for a user
   * @param userId - The ID of the user
   * @returns A promise that resolves to an array of pages
   */
  async getUserPages(userId: string): Promise<Page[]> {
    try {
      // For development/testing, use mock data if no API URL is available
      if (!this.apiUrl || import.meta.env.DEV) {
        return this.getMockPages(userId);
      }

      const response = await fetch(`${this.apiUrl}/pages?user_id=${userId}`, {
        credentials: 'include',
      });

      if (!response.ok) {
        throw new Error(`Failed to fetch pages: ${response.status}`);
      }

      return await response.json();
    } catch (error) {
      console.error('Error fetching user pages:', error);
      return [];
    }
  }

  /**
   * Create a new page for a user
   * @param userId - The ID of the user
   * @param title - The title of the page
   * @param icon - Optional icon for the page
   * @param parentId - Optional parent page ID
   * @returns A promise that resolves to the created page
   */
  async createPage(userId: string, title: string, icon?: string, parentId?: string): Promise<Page | null> {
    try {
      const response = await fetch(`${this.apiUrl}/pages`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        credentials: 'include',
        body: JSON.stringify({
          user_id: userId,
          title,
          icon,
          parent_id: parentId,
        }),
      });

      if (!response.ok) {
        throw new Error(`Failed to create page: ${response.status}`);
      }

      return await response.json();
    } catch (error) {
      console.error('Error creating page:', error);
      return null;
    }
  }

  /**
   * Generate mock pages for development and testing
   * @param userId - The ID of the user
   * @returns An array of mock pages
   */
  private getMockPages(userId: string): Page[] {
    return [
      {
        id: '1',
        user_id: userId,
        title: 'Getting Started',
        icon: '📝',
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      },
      {
        id: '2',
        user_id: userId,
        title: 'Project Plan',
        icon: '📊',
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      },
      {
        id: '3',
        user_id: userId,
        title: 'Meeting Notes',
        icon: '📅',
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      },
      {
        id: '4',
        user_id: userId,
        title: 'Ideas',
        icon: '💡',
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      },
    ];
  }
}

export default new PageService();
