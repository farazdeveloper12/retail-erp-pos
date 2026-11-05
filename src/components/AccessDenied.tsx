import { Lock } from "lucide-react";

export default function AccessDenied() {
  return (
    <div className="mx-auto max-w-md rounded-xl border border-slate-200 bg-white p-8 text-center shadow-sm dark:border-slate-800 dark:bg-slate-900">
      <Lock className="mx-auto h-8 w-8 text-slate-400" />
      <h1 className="mt-3 text-lg font-bold">Is page ki ijazat nahi hai</h1>
      <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
        Aap ke account ko ye page dekhne ki ijazat nahi mili. Zaroorat ho to
        Owner se rabta karein.
      </p>
    </div>
  );
}