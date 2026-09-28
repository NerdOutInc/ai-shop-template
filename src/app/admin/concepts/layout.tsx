export default function ConceptsLayout({ children }: { children: React.ReactNode }) {
  return (
    <main id="main-content" className="page-width py-10 sm:py-14" tabIndex={-1}>
      {children}
    </main>
  )
}
