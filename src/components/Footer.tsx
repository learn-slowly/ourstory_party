export function Footer() {
  return (
    <footer className="mt-12 border-t border-zinc-200 py-6 text-xs text-zinc-500 dark:border-zinc-800 dark:text-zinc-400">
      <div className="mx-auto max-w-7xl px-4">
        데이터 출처: 중앙선거관리위원회 · 공공데이터포털 ·{" "}
        <a
          href="https://github.com/learn-slowly/ourstory_party"
          className="underline"
          target="_blank"
          rel="noopener"
        >
          GitHub
        </a>
      </div>
    </footer>
  );
}
