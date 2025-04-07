import { 
  createRootRoute, 
  createRoute, 
  createRouter,
  Outlet,
  Link
} from '@tanstack/react-router';
import App from './App';
import Sidebar from './components/Sidebar';
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { AuthProvider, useAuth } from './contexts/auth-context';
import Page from './components/Page';
import Login from './components/Login';

// Define search param interfaces
interface CallbackSearchParams {
  code: string;
}

const queryClient = new QueryClient();

// Root layout that conditionally renders the sidebar
const RootLayout = () => {
  const { userId  , isLoading } = useAuth();
  
  return (
    <div className="app-container">
      {userId && <Sidebar />}
      <div className={`main-content ${!userId ? 'full-width' : ''}`}>
        <Outlet />
      </div>
    </div>
  );
};

// Root route
export const rootRoute = createRootRoute({
  component: () => (
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <RootLayout />
      </AuthProvider>
    </QueryClientProvider>
  ),
});

// Define routes
export const indexRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/',
  component: App,
});

export const pageRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/page/$pageId',
  component: Page,
});

export const loginRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/login',
  component: Login,
});

// Create the router
export const router = createRouter({
  routeTree: rootRoute.addChildren([
    indexRoute,
    pageRoute,
    loginRoute,
  ]),
});

// Register the router for type safety
declare module '@tanstack/react-router' {
  interface Register {
    router: typeof router;
  }
}
