// The bar at the top of each main view (chat, file manager, file viewer): one height and one menu button for all
import type { ComponentChildren } from 'preact';
import { sidebarOpen } from '../state/ui';
import { Icon, IconButton, cx } from './ui';
import { t } from './messages';

/** wrap: let the contents take two rows on narrow screens. Children placed `absolute inset-0` cover the whole bar */
export function PageHeader({ wrap, children }: { wrap?: boolean; children: ComponentChildren }) {
  return (
    <header class={cx('glass relative mx-2 mt-2 flex min-h-12 items-center gap-1 rounded-2xl px-2 py-1.5 sm:mx-3 md:mt-0 md:mr-3 md:ml-0', wrap && 'flex-wrap')}>
      <IconButton class="md:hidden" label={t('pageHeader.menu')} onClick={() => (sidebarOpen.value = true)}>
        <Icon name="menu" class="size-5" />
      </IconButton>
      {children}
    </header>
  );
}
