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
import { AuthProvider } from './contexts/auth-context';

// Define search param interfaces
interface CallbackSearchParams {
  code: string;
}

const queryClient = new QueryClient();

// Root route
export const rootRoute = createRootRoute({
  component: () => (
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
      <div className="app-container">
        <Sidebar />
        <div className="main-content">
          <Outlet />
        </div>
      </div>
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

// Create the router
export const router = createRouter({
  routeTree: rootRoute.addChildren([
    indexRoute,
  ]),
});

// Register the router for type safety
declare module '@tanstack/react-router' {
  interface Register {
    router: typeof router;
  }
}
