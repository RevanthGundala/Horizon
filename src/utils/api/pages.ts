import { getUrl } from '../api';
import { Database, Tables } from '../../types/db';
import { Block } from './blocks';

// Types
export type Page = Tables<'pages'>;
export type PageInsert = Database['public']['Tables']['pages']['Insert'];
export type PageUpdate = Database['public']['Tables']['pages']['Update'];

export interface CreatePageRequest {
  title: string;
  parentId?: string;
  type?: string;
}

export interface UpdatePageRequest {
  title?: string;
  parentId?: string;
  isFavorite?: boolean;
  type?: string;
}

// API functions
export async function getPages(parentId?: string): Promise<Page[]> {
  const queryParams = parentId ? `?parentId=${parentId}` : '';
  const response = await fetch(getUrl(`/api/pages${queryParams}`), {
    method: 'GET',
    credentials: 'include',
  });
  
  if (!response.ok) {
    throw new Error(`Failed to fetch pages: ${response.statusText}`);
  }
  
  const data = await response.json();
  return data.pages;
}

export async function getPage(pageId: string): Promise<{ page: Page; blocks: Block[] }> {
  const response = await fetch(getUrl(`/api/pages/${pageId}`), {
    method: 'GET',
    credentials: 'include',
  });
  
  if (!response.ok) {
    throw new Error(`Failed to fetch page: ${response.statusText}`);
  }
  
  return await response.json();
}

export async function createPage(pageData: CreatePageRequest): Promise<Page> {
  const response = await fetch(getUrl('/api/pages'), {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    credentials: 'include',
    body: JSON.stringify(pageData),
  });
  
  if (!response.ok) {
    throw new Error(`Failed to create page: ${response.statusText}`);
  }
  
  const data = await response.json();
  return data.page;
}

export async function updatePage(pageId: string, pageData: UpdatePageRequest): Promise<Page> {
  const response = await fetch(getUrl(`/api/pages/${pageId}`), {
    method: 'PUT',
    headers: {
      'Content-Type': 'application/json',
    },
    credentials: 'include',
    body: JSON.stringify(pageData),
  });
  
  if (!response.ok) {
    throw new Error(`Failed to update page: ${response.statusText}`);
  }
  
  const data = await response.json();
  return data.page;
}

export async function deletePage(pageId: string): Promise<void> {
  const response = await fetch(getUrl(`/api/pages/${pageId}`), {
    method: 'DELETE',
    credentials: 'include',
  });
  
  if (!response.ok) {
    throw new Error(`Failed to delete page: ${response.statusText}`);
  }
}
