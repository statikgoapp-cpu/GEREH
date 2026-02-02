import { Link } from "wouter";
import { Pattern } from "@shared/schema";
import { formatDistanceToNow } from "date-fns";
import { ArrowRight, FileCheck, Loader2, AlertCircle, Image as ImageIcon } from "lucide-react";
import { motion } from "framer-motion";

interface PatternCardProps {
  pattern: Pattern;
}

export function PatternCard({ pattern }: PatternCardProps) {
  const statusColor = {
    pending: "text-yellow-600 bg-yellow-50 border-yellow-200",
    processing: "text-blue-600 bg-blue-50 border-blue-200",
    completed: "text-green-600 bg-green-50 border-green-200",
    failed: "text-red-600 bg-red-50 border-red-200",
  }[pattern.status] || "text-gray-600 bg-gray-50 border-gray-200";

  const StatusIcon = {
    pending: Loader2,
    processing: Loader2,
    completed: FileCheck,
    failed: AlertCircle,
  }[pattern.status] || Loader2;

  return (
    <Link href={`/pattern/${pattern.id}`}>
      <motion.div 
        whileHover={{ y: -4, transition: { duration: 0.2 } }}
        className="group relative bg-white rounded-xl border border-border shadow-sm hover:shadow-xl hover:border-primary/20 transition-all duration-300 cursor-pointer overflow-hidden flex flex-col h-full"
      >
        {/* Image Preview Area */}
        <div className="relative aspect-[4/3] bg-muted/30 overflow-hidden border-b border-border/50">
          <img 
            src={pattern.imageUrl} 
            alt={`Pattern #${pattern.id}`}
            className="w-full h-full object-cover transition-transform duration-500 group-hover:scale-105"
          />
          <div className="absolute inset-0 bg-black/0 group-hover:bg-black/5 transition-colors duration-300" />
          
          <div className="absolute top-3 right-3">
             <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium border ${statusColor}`}>
               <StatusIcon className={`w-3.5 h-3.5 ${pattern.status === 'processing' || pattern.status === 'pending' ? 'animate-spin' : ''}`} />
               {pattern.status.charAt(0).toUpperCase() + pattern.status.slice(1)}
             </span>
          </div>
        </div>

        {/* Content Area */}
        <div className="p-5 flex flex-col flex-1">
          <div className="flex items-start justify-between mb-2">
            <div>
              <h3 className="font-display font-semibold text-lg text-foreground group-hover:text-primary transition-colors">
                Pattern #{pattern.id}
              </h3>
              <p className="text-sm text-muted-foreground mt-1 font-mono">
                {pattern.createdAt ? formatDistanceToNow(new Date(pattern.createdAt), { addSuffix: true }) : 'Just now'}
              </p>
            </div>
          </div>
          
          <div className="mt-auto pt-4 flex items-center justify-between text-sm">
            <span className="flex items-center gap-1.5 text-muted-foreground">
              <ImageIcon className="w-4 h-4" />
              <span>Raster</span>
            </span>
            
            <div className="flex items-center gap-1 text-primary font-medium opacity-0 group-hover:opacity-100 transition-opacity transform translate-x-2 group-hover:translate-x-0 duration-300">
              View Details <ArrowRight className="w-4 h-4" />
            </div>
          </div>
        </div>
      </motion.div>
    </Link>
  );
}
