import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api, buildUrl } from "@shared/routes";
import { useToast } from "@/hooks/use-toast";
import { patterns } from "@shared/schema";
import { useI18n } from "@/i18n";
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
  const { t } = useI18n();
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
        title: t("pattern_uploaded"),
        description: t("pattern_processing_desc")
      });
    },
    onError: (error) => {
      toast({
        title: t("upload_failed"),
        description: error.message,
        variant: "destructive",
      });
    }
  });
}

export function useDeletePattern() {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const { t } = useI18n();
  return useMutation({
    
    mutationFn: async (id: number) => {
      const url = buildUrl(api.patterns.delete.path, { id });
      const res = await fetch(url, { method: api.patterns.delete.method, credentials: "include" });
      if (res.status === 404) {
        const error = api.patterns.delete.responses[404].parse(await res.json());
        throw new Error(error.message);
      }
      if (!res.ok) throw new Error("Failed to delete pattern");
      return api.patterns.delete.responses[200].parse(await res.json());
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [api.patterns.list.path] });
      toast({
        title: t("pattern_deleted"),
        description: t("delete_success_desc",)
      });
    },
    onError: (error) => {
      toast({
        title: t("delete_failed_title"),
        description: error.message,
        variant: "destructive",
      });
    },
  });
}

export function useDeletePatternsBulk() {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const { t } = useI18n();

  return useMutation({
    mutationFn: async (ids: number[]) => {
      await Promise.all(
        ids.map(async (id) => {
          const url = buildUrl(api.patterns.delete.path, { id });
          const res = await fetch(url, {
            method: api.patterns.delete.method,
            credentials: "include",
          });
          if (!res.ok && res.status !== 404) {
            throw new Error(`Failed to delete pattern ${id}`);
          }
        })
      );
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [api.patterns.list.path] });
      toast({
        title: t("pattern_deleted"),
        description: "Selected patterns were deleted.",
      });
    },
    onError: (error) => {
      toast({
        title: t("bulk_delete_failed"),
        description: error.message,
        variant: "destructive",
      });
    },
  });
}

export function useArchivePattern() {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const { t } = useI18n();

  return useMutation({
    mutationFn: async ({ id, archived }: { id: number; archived: boolean }) => {
      const url = buildUrl(api.patterns.archive.path, { id });
      const res = await fetch(url, {
        method: api.patterns.archive.method,
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ archived }),
      });
      if (!res.ok) {
        throw new Error("Failed to update archive status");
      }
      return api.patterns.archive.responses[200].parse(await res.json());
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [api.patterns.list.path] });
    },
    onError: (error) => {
      toast({
        title: t("archive_failed_title"),
        description: error.message,
        variant: "destructive",
      });
    },
  });
}
