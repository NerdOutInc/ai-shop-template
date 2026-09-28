"use client"

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"

export default function ConceptLibraryError({ reset }: { reset: () => void }) {
  return (
    <div className="flex flex-col gap-5">
      <h1 className="display-heading">The library is taking a breather.</h1>
      <Alert variant="destructive">
        <AlertTitle>Designs could not be loaded</AlertTitle>
        <AlertDescription>
          Your library has not been cleared. Try again, or check your account and the library connection.
        </AlertDescription>
      </Alert>
      <Button onClick={reset} className="min-h-11 w-fit">
        Try again
      </Button>
    </div>
  )
}
