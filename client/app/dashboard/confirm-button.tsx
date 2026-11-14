"use client";

import { Button } from "@/components/ui/button";

// Submit button that asks first; used for Forget, which can't be undone.
export function ConfirmButton({ message, ...props }: React.ComponentProps<typeof Button> & { message: string }) {
  return <Button {...props} onClick={(e) => { if (!confirm(message)) e.preventDefault(); }} />;
}
