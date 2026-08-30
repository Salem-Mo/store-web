export default function Page() {
  return (
    <main className="min-h-screen w-full bg-[#f3f6fa]">
      <iframe
        src="/static/index.html"
        title="سوبر ماركت أيوب - للنظم الذكية"
        className="block h-[100dvh] w-full border-0"
        loading="eager"
        // allow camera for barcode scanning inside iframe; fullscreen for PWA parity
        allow="camera; fullscreen; clipboard-write"
        // sandbox keeps same-origin so fetch/Supabase auth works; allow required features
        sandbox="allow-same-origin allow-scripts allow-forms allow-popups allow-modals allow-downloads"
        referrerPolicy="strict-origin-when-cross-origin"
      />
      <noscript>
        <div className="mx-auto max-w-xl p-8 text-center">
          <p className="text-sm text-muted-foreground">
            يجب تفعيل JavaScript لتشغيل نظام سوبر ماركت أيوب. الرجاء تفعيل JavaScript وإعادة تحميل الصفحة.
          </p>
        </div>
      </noscript>
    </main>
  )
}
