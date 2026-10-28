import defineMessages from '@app/utils/defineMessages';
import type { MediaCleanup } from '@server/lib/cleanup/types';
import type { IntlShape } from 'react-intl';

export const messages = defineMessages('components.LibraryCleanup', {
  leavingBadge: 'Leaving {date}',
  leavingHead: 'Leaving {date}',
  neverWatched:
    'Nobody has watched it since it was added {added}, so it will be removed to free up space unless someone keeps it.',
  notWatchedSince:
    'Nobody has watched it since {watched}, so it will be removed to free up space unless someone keeps it.',
  keptHead: 'Kept until {date}',
  keptByYou: "You kept it, so it won't be removed before then.",
  keptBySomeone: "Someone kept it, so it won't be removed before then.",
  protectedHead: 'Protected from cleanup',
  protectedBody:
    "It won't be removed automatically, however long it goes unwatched.",
  removedHead: 'Removed {date} to free up space',
  removedBody:
    'Nobody had watched it in a while. Request it again to bring it back.',
  keep: 'Keep',
  keepTip: 'Keeps it for {days} days. You can keep {left} more.',
  keepNoneLeft:
    'You can keep {max} titles at a time. Undo a keep on another title first.',
  undoKeep: 'Undo Keep',
  protect: 'Protect',
  unprotect: 'Remove Protection',
  kept: 'Kept for {days} days.',
  failed: 'Something went wrong. Try again later.',
});

/** "Nov 4", with the year only when it isn't this year. */
export const shortDate = (intl: IntlShape, iso: string) =>
  intl.formatDate(iso, {
    month: 'short',
    day: 'numeric',
    ...(new Date(iso).getFullYear() !== new Date().getFullYear() && {
      year: 'numeric',
    }),
  });

/** "8 months ago", "2 years ago". */
export const ago = (intl: IntlShape, iso: string) => {
  const days = (Date.now() - new Date(iso).getTime()) / 86400000;
  const [value, unit]: [number, Intl.RelativeTimeFormatUnit] =
    days < 60
      ? [Math.round(days), 'day']
      : days < 730
        ? [Math.round(days / 30.4), 'month']
        : [Math.round(days / 365), 'year'];
  return intl.formatRelativeTime(-value, unit, { numeric: 'auto' });
};

export const leavingReason = (intl: IntlShape, cleanup: MediaCleanup) =>
  cleanup.reason?.lastWatchedAt
    ? intl.formatMessage(messages.notWatchedSince, {
        watched: ago(intl, cleanup.reason.lastWatchedAt),
      })
    : intl.formatMessage(messages.neverWatched, {
        added: cleanup.reason?.addedAt ? ago(intl, cleanup.reason.addedAt) : '',
      });
