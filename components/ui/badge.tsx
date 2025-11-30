import { cn } from '@/lib/utils'

export type BadgeVariant = 
  | 'default'
  | 'severity-critical'
  | 'severity-severe'
  | 'severity-moderate'
  | 'severity-minimal'
  | 'status-success'
  | 'status-warning'
  | 'status-error'
  | 'status-info'
  | 'secondary'

interface BadgeProps {
  children: React.ReactNode
  variant?: BadgeVariant
  className?: string
}

const variantStyles: Record<BadgeVariant, string> = {
  default: 'bg-gray-200 text-gray-800',
  'severity-critical': 'bg-red-600 text-white',
  'severity-severe': 'bg-orange-600 text-white',
  'severity-moderate': 'bg-yellow-500 text-gray-900',
  'severity-minimal': 'bg-green-600 text-white',
  'status-success': 'bg-green-100 text-green-800',
  'status-warning': 'bg-yellow-100 text-yellow-800',
  'status-error': 'bg-red-100 text-red-800',
  'status-info': 'bg-blue-100 text-blue-800',
  secondary: 'bg-gray-100 text-gray-700',
}

export function Badge({ children, variant = 'default', className }: BadgeProps) {
  return (
    <span
      className={cn(
        'inline-flex items-center px-1.5 py-0.5 text-[11px] font-medium rounded',
        variantStyles[variant],
        className
      )}
    >
      {children}
    </span>
  )
}

