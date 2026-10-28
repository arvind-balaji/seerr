import Button from '@app/components/Common/Button';
import DiagnosisModal from '@app/components/RequestDiagnosis/DiagnosisModal';
import {
  diagnosisBadge,
  diagnosisText,
} from '@app/components/RequestDiagnosis/labels';
import useSettings from '@app/hooks/useSettings';
import { Permission, useUser } from '@app/hooks/useUser';
import defineMessages from '@app/utils/defineMessages';
import {
  ExclamationTriangleIcon,
  InformationCircleIcon,
} from '@heroicons/react/24/outline';
import { MediaRequestStatus, MediaStatus } from '@server/constants/media';
import { MediaServerType } from '@server/constants/server';
import type Media from '@server/entity/Media';
import { DiagnosisCategory } from '@server/lib/diagnostics/types';
import { useState } from 'react';
import { useIntl } from 'react-intl';

const messages = defineMessages('components.RequestDiagnosis', {
  whyNotYet: 'Why isn’t this available yet?',
  details: 'Details & Options',
});

/** Shown on title pages to the requester (and managers) while a request is stuck. */
const DiagnosisCallout = ({
  media,
  title,
  is4k = false,
  onChange,
}: {
  media?: Media;
  title: string;
  is4k?: boolean;
  onChange?: () => void;
}) => {
  const intl = useIntl();
  const settings = useSettings();
  const { user, hasPermission } = useUser();
  const [open, setOpen] = useState(false);
  const diagnosis = media?.[is4k ? 'diagnosis4k' : 'diagnosis'];
  const status = media?.[is4k ? 'status4k' : 'status'];
  const isRequester = (media?.requests ?? []).some(
    (r) =>
      r.is4k === is4k &&
      r.status === MediaRequestStatus.APPROVED &&
      r.requestedBy?.id === user?.id
  );

  if (
    !media ||
    !diagnosis ||
    !(isRequester || hasPermission(Permission.MANAGE_REQUESTS)) ||
    ![MediaStatus.PROCESSING, MediaStatus.PARTIALLY_AVAILABLE].includes(
      status ?? MediaStatus.UNKNOWN
    ) ||
    [
      DiagnosisCategory.DOWNLOADING,
      DiagnosisCategory.PENDING_CHECK,
      DiagnosisCategory.FULFILLED,
    ].includes(diagnosis.category) ||
    // A partly-available show that is simply waiting for new episodes is normal.
    (status === MediaStatus.PARTIALLY_AVAILABLE &&
      diagnosis.category === DiagnosisCategory.NOT_RELEASED)
  ) {
    return null;
  }

  const mediaType = media.mediaType === 'movie' ? 'movie' : 'tv';
  const text = diagnosisText(intl, diagnosis, {
    mediaType,
    mediaServer:
      settings.currentSettings.mediaServerType === MediaServerType.PLEX
        ? 'Plex'
        : 'Jellyfin',
  });
  const badge = diagnosisBadge(intl, diagnosis, mediaType);
  const attention =
    badge?.badgeType === 'warning' || badge?.badgeType === 'danger';
  const Icon = attention ? ExclamationTriangleIcon : InformationCircleIcon;

  return (
    <>
      <div
        className={`mb-6 flex flex-col gap-3 rounded-lg border p-4 sm:flex-row sm:items-center ${
          attention
            ? 'border-yellow-500/50 bg-yellow-500/10'
            : 'border-indigo-500/50 bg-indigo-500/10'
        }`}
      >
        <Icon
          className={`hidden h-8 w-8 flex-shrink-0 sm:block ${
            attention ? 'text-yellow-400' : 'text-indigo-300'
          }`}
        />
        <div className="flex-1 text-sm text-gray-200">
          <p className="text-xs font-semibold uppercase tracking-wide text-gray-400">
            {intl.formatMessage(messages.whyNotYet)}
          </p>
          <p className="font-semibold text-white">{text.headline}</p>
          <p>{text.body[0]}</p>
        </div>
        <Button
          buttonType={attention ? 'warning' : 'default'}
          buttonSize="sm"
          className="flex-shrink-0"
          onClick={() => setOpen(true)}
        >
          {intl.formatMessage(messages.details)}
        </Button>
      </div>
      <DiagnosisModal
        show={open}
        mediaId={media.id}
        is4k={is4k}
        subTitle={title}
        onClose={() => setOpen(false)}
        onChange={onChange}
      />
    </>
  );
};

export default DiagnosisCallout;
