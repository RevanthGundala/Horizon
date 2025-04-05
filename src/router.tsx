import { 
  createRootRoute, 
  createRoute, 
  createRouter,
  Outlet,
  Link
} from '@tanstack/react-router';
import App from './App';
import UserProfile from './components/UserProfile';
import Login from './components/Login';
import AuthCallback from './components/AuthCallback';

// Define search param interfaces
interface CallbackSearchParams {
  code: string;
}

// Root route
export const rootRoute = createRootRoute({
  component: () => (
    <>
      <div className="navbar">
        <Link to="/" className="nav-link">Home</Link>
        <Link to="/profile" className="nav-link">Profile</Link>
      </div>
      <Outlet />
    </>
  ),
});

// Define routes
export const indexRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/',
  component: App,
});

export const profileRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/profile',
  component: UserProfile,
});

export const loginRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/login',
  component: Login,
});

export const callbackRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/auth/callback',
  validateSearch: (search: Record<string, unknown>): CallbackSearchParams => {
    // Validate and transform search parameters
    return {
      code: search.code as string,
    };
  },
  component: AuthCallback,
});

// Create the router
export const router = createRouter({
  routeTree: rootRoute.addChildren([
    indexRoute,
    profileRoute,
    loginRoute,
    callbackRoute,
  ]),
});

// Register the router for type safety
declare module '@tanstack/react-router' {
  interface Register {
    router: typeof router;
  }
}
