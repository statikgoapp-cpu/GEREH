import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api, buildUrl } from "@shared/routes";
import { useToast } from "@/hooks/use-toast";
import { patterns } from "@shared/schema";

type Pattern = typeof patterns.$inferSelect;

export function usePatterns() {
  return useQuery({
    queryKey: [api.patterns.list.path],
    queryFn: async () => {
      const res = await fetch(api.patterns.list.path, { credentials: "include" });
      if (!res.ok) throw new Error("Failed to fetch patterns");
      return api.patterns.list.responses[200].parse(await res.json());
    },
  });
}

export function usePattern(id: number) {
  return useQuery({
    queryKey: [api.patterns.get.path, id],
    queryFn: async () => {
      const url = buildUrl(api.patterns.get.path, { id });
      const res = await fetch(url, { credentials: "include" });
      if (res.status === 404) return null;
      if (!res.ok) throw new Error("Failed to fetch pattern");
      return api.patterns.get.responses[200].parse(await res.json());
    },
    // Poll every 2 seconds if status is processing or pending
    refetchInterval: (query) => {
      const data = query.state.data;
      if (data && (data.status === "pending" || data.status === "processing")) {
        return 2000;
      }
      return false;
    }
  });
}

export function useCreatePattern() {
  const queryClient = useQueryClient();
  const { toast } = useToast();

  return useMutation({
    mutationFn: async (formData: FormData) => {
      const res = await fetch(api.patterns.create.path, {
        method: api.patterns.create.method,
        body: formData, // Sending FormData directly for file upload
        credentials: "include",
      });

      if (!res.ok) {
        if (res.status === 400) {
          const error = api.patterns.create.responses[400].parse(await res.json());
          throw new Error(error.message);
        }
        throw new Error("Failed to create pattern");
      }
      return api.patterns.create.responses[201].parse(await res.json());
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [api.patterns.list.path] });
      toast({
        title: "Pattern Uploaded",
        description: "Your pattern is now being processed by the neural engine.",
      });
    },
    onError: (error) => {
      toast({
        title: "Upload Failed",
        description: error.message,
        variant: "destructive",
      });
    }
  });
}
