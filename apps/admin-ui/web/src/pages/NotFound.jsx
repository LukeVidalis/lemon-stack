import { Link } from 'react-router-dom';

export default function NotFound() {
  return (
    <div className="flex flex-col items-center justify-center py-24 text-center">
      <h1 className="text-4xl font-semibold text-zinc-900 dark:text-zinc-100">404</h1>
      <p className="mt-2 text-zinc-600 dark:text-zinc-400">That page does not exist.</p>
      <Link
        to="/"
        className="mt-6 rounded-md bg-zinc-900 px-4 py-2 text-sm font-medium text-white hover:bg-zinc-800 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-200"
      >
        Back to Users
      </Link>
    </div>
  );
}
