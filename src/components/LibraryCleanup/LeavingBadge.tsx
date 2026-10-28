import Badge from '@app/components/Common/Badge';
import { messages, shortDate } from '@app/components/LibraryCleanup/labels';
import type { MediaCleanup } from '@server/lib/cleanup/types';
import { useIntl } from 'react-intl';

/** "Leaving Nov 4" next to the status badge on title pages. */
const LeavingBadge = ({ cleanup }: { cleanup?: MediaCleanup | null }) => {
  const intl = useIntl();
  if (cleanup?.state !== 'leaving' || !cleanup.removeAt) return null;
  return (
    <Badge badgeType="warning" href="/leaving-soon">
      {intl.formatMessage(messages.leavingBadge, {
        date: shortDate(intl, cleanup.removeAt),
      })}
    </Badge>
  );
};

export default LeavingBadge;
