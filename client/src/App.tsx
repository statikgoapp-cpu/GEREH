import Analytics from "./pages/Analytics";
import { Switch, Route, Redirect, useLocation } from "wouter";
import { useEffect, useRef } from "react";
import { queryClient } from "./lib/queryClient";
import { QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import NotFound from "@/pages/not-found";
import Home from "@/pages/Home";
import NewPattern from "@/pages/NewPattern";
import PatternDetails from "@/pages/PatternDetails";
import RhinestoneTransfer from "@/pages/RhinestoneTransfer";
import RhinestoneFill from "@/pages/RhinestoneFill";
import Archive from "@/pages/Archive";
import Settings from "@/pages/Settings";
import RhinestoneProductionEdit from "@/pages/RhinestoneProductionEdit";
import Layout from "@/components/Layout";
import AuthPage from "./pages/Auth";
import { MachineControlPanel } from "@/components/MachineControlPanel";
import { AuthProvider, useAuth } from "./hooks/use-auth";
import { trackEvent } from "./lib/analytics";

function AnalyticsTracker() {
  const { user } = useAuth();
  const [location] = useLocation();
  const openedForUser = useRef<number | null>(null);

  useEffect(() => {
    if (!user) return;
    if (openedForUser.current !== user.id) {
      openedForUser.current = user.id;
      trackEvent("APP_OPEN", location);
    }
    trackEvent("PAGE_VIEW", location, { page: location });
  }, [location, user]);

  return null;
}

function AdminAnalyticsRoute() {
  const { user, isLoading } = useAuth();
  if (isLoading) return <div className="min-h-screen flex items-center justify-center">Loading...</div>;
  if (!user || user.role !== "admin") return <Redirect to="/" />;
  return <Analytics />;
}

function ProtectedRoute({
  component: Component,
}: {
  component: React.ComponentType;
}) {
  const { user, isLoading } = useAuth();

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-sm text-muted-foreground">Loading...</div>
      </div>
    );
  }

  if (!user) {
    return <Redirect to="/auth" />;
  }

  return <Component />;
}

function AuthRoute() {
  const { user, isLoading } = useAuth();

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-sm text-muted-foreground">Loading...</div>
      </div>
    );
  }

  if (user) {
    return <Redirect to="/" />;
  }

  return <AuthPage />;
}

function Router() {
  return (
    <Switch>
      <Route path="/auth" component={AuthRoute} />

      <Route path="/" component={() => <ProtectedRoute component={Home} />} />
      <Route
        path="/machine-control"
        component={() => <ProtectedRoute component={MachineControlPanel} />}
      />
      <Route path="/new" component={() => <ProtectedRoute component={NewPattern} />} />
      <Route
        path="/rhinestone-transfer"
        component={() => <ProtectedRoute component={RhinestoneTransfer} />}
      />
      <Route
        path="/rhinestone-fill"
        component={() => <ProtectedRoute component={RhinestoneFill} />}
      />
      <Route
        path="/archive"
        component={() => <ProtectedRoute component={Archive} />}
      />
      <Route
        path="/settings"
        component={() => <ProtectedRoute component={Settings} />}
      />
      <Route path="/analytics" component={AdminAnalyticsRoute} />
      <Route
        path="/production-edit"
        component={() => <ProtectedRoute component={RhinestoneProductionEdit} />}
      />
      <Route
        path="/pattern/:id"
        component={() => <ProtectedRoute component={PatternDetails} />}
      />

      <Route component={NotFound} />
    </Switch>
  );
}

function AppContent() {
  const { user } = useAuth();

  return (
    <>
      <AnalyticsTracker />
      {user ? (
        <Layout>
          <Router />
        </Layout>
      ) : (
        <Router />
      )}
    </>
  );
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <TooltipProvider>
          <Toaster />
          <AppContent />
        </TooltipProvider>
      </AuthProvider>
    </QueryClientProvider>
  );
}

export default App;
