import * as React from 'react';
import { cva, type VariantProps } from 'class-variance-authority';
import { clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';
const buttonVariants = cva('button', { variants: { variant: { default: 'button-primary', outline: 'button-outline', ghost: 'button-ghost', destructive: 'button-danger' }, size: { default: '', icon: 'button-icon', sm: 'button-small' } }, defaultVariants: { variant: 'default', size: 'default' } });
export function Button({ className, variant, size, ...props }: React.ComponentProps<'button'> & VariantProps<typeof buttonVariants>) {
  return <button className={twMerge(clsx(buttonVariants({ variant, size }), className))} {...props} />;
}
