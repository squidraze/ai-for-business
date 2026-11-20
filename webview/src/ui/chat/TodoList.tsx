import { Check, Circle, LoaderCircle } from 'lucide-react';
import clsx from 'clsx';
import { memo } from 'react';

import type { TodoItem } from '@/chat/types';
import { useTranslation } from '@/i18n';

/**
 * The agent's plan for a multi-step reply (`ai.todos` live, `write_todos` from
 * history), above the reply's text: "Tasks · 2 of 5", done lines checked and
 * struck through, the current one spinning while the reply is live — the web
 * client's `TodoList`, on this app's tokens.
 */
function TodoListBase({ todos, live }: { todos: TodoItem[]; live: boolean }) {
  const { t } = useTranslation();
  if (todos.length === 0) return null;
  const done = todos.filter((todo) => todo.status === 'completed').length;

  return (
    <div className="w-full rounded-[14px] border border-border bg-surface px-3 py-2.5">
      <p className="text-[0.75rem] leading-4 font-medium text-label-secondary">
        {t('todos.progress', { done, total: todos.length })}
      </p>
      <ul className="mt-1.5 flex flex-col gap-1">
        {todos.map((todo, index) => {
          const completed = todo.status === 'completed';
          const current = todo.status === 'in_progress';
          return (
            <li
              key={`${index}-${todo.content}`}
              className="flex items-start gap-2 text-[0.875rem] leading-5"
            >
              <span className="mt-0.5 flex size-4 shrink-0 items-center justify-center">
                {completed ? (
                  <Check size={16} className="text-success" aria-hidden />
                ) : current ? (
                  <LoaderCircle
                    size={16}
                    className={clsx('text-primary', live && 'animate-spin')}
                    aria-hidden
                  />
                ) : (
                  <Circle size={14} className="text-label-tertiary" aria-hidden />
                )}
              </span>
              <span
                className={clsx(
                  completed ? 'text-label-tertiary line-through' : 'text-label',
                  current && 'font-medium',
                )}
              >
                {todo.content}
              </span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

export const TodoList = memo(TodoListBase);
