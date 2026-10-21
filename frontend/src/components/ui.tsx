import type { ButtonHTMLAttributes, InputHTMLAttributes, ReactNode, SelectHTMLAttributes, TextareaHTMLAttributes } from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

const buttonStyles = cva(
  "inline-flex items-center justify-center gap-2 rounded-xl px-4 py-2.5 text-sm font-semibold transition disabled:cursor-not-allowed disabled:opacity-50",
  {
    variants: {
      variant: {
        primary: "bg-cyan-700 text-white hover:bg-cyan-800",
        secondary: "bg-white text-navy-900 ring-1 ring-slate-200 hover:bg-slate-50",
        ghost: "text-slate-600 hover:bg-slate-100",
        danger: "bg-rose-600 text-white hover:bg-rose-700",
      },
    },
    defaultVariants: { variant: "primary" },
  },
);

export function Button({ className, variant, ...props }: ButtonHTMLAttributes<HTMLButtonElement> & VariantProps<typeof buttonStyles>) {
  return <button className={cn(buttonStyles({ variant }), className)} {...props} />;
}

export function Input(props: InputHTMLAttributes<HTMLInputElement>) {
  return <input {...props} className={cn("h-11 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm outline-none ring-cyan-700/30 placeholder:text-slate-400 focus:ring-4", props.className)} />;
}

export function Select(props: SelectHTMLAttributes<HTMLSelectElement>) {
  return <select {...props} className={cn("h-11 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm outline-none focus:ring-4 focus:ring-cyan-700/30", props.className)} />;
}

export function Textarea(props: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea {...props} className={cn("min-h-28 w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm outline-none focus:ring-4 focus:ring-cyan-700/30", props.className)} />;
}

export function Label({ children, hint }: { children: ReactNode; hint?: string }) {
  return (
    <label className="grid gap-1.5 text-sm font-medium text-slate-700">
      <span>{children}{hint ? <span className="ml-2 font-normal text-slate-400">{hint}</span> : null}</span>
    </label>
  );
}

export function Field({ label, error, children }: { label: string; error?: string; children: ReactNode }) {
  return (
    <label className="grid gap-1.5">
      <span className="text-sm font-medium text-slate-700">{label}</span>
      {children}
      {error ? <span className="text-xs text-rose-600">{error}</span> : null}
    </label>
  );
}

export function Card({ className, children }: { className?: string; children: ReactNode }) {
  return <section className={cn("rounded-2xl border border-slate-200/80 bg-white p-5 shadow-sm", className)}>{children}</section>;
}

const badgeStyles: Record<string, string> = {
  aberta: "bg-cyan-50 text-cyan-800",
  ativa: "bg-emerald-50 text-emerald-800",
  preenchida: "bg-blue-50 text-blue-800",
  encerrada: "bg-slate-100 text-slate-600",
  capacidade_pendente: "bg-amber-50 text-amber-800",
  indefinida: "bg-slate-100 text-slate-600",
  clt: "bg-blue-50 text-blue-800",
  estagio: "bg-violet-50 text-violet-800",
};

export function Badge({ value, children }: { value?: string; children: ReactNode }) {
  return <span className={cn("inline-flex rounded-full px-2.5 py-1 text-xs font-semibold", badgeStyles[value ?? ""] ?? "bg-slate-100 text-slate-700")}>{children}</span>;
}

export function Skeleton({ className }: { className?: string }) {
  return <div className={cn("animate-pulse rounded-xl bg-slate-200/80", className)} />;
}

export function Empty({ title, text }: { title: string; text: string }) {
  return (
    <div className="rounded-2xl border border-dashed border-slate-300 bg-slate-50 px-6 py-12 text-center">
      <h3 className="text-base font-semibold text-navy-900">{title}</h3>
      <p className="mt-1 text-sm text-slate-500">{text}</p>
    </div>
  );
}
