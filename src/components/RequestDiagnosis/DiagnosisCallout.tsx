import Button from '@app/components/Common/Button';
import DiagnosisModal from '@app/components/RequestDiagnosis/DiagnosisModal';
import {
  diagnosisBadge,
  diagnosisText,
} from '@app/components/RequestDiagnosis/labels';
import useSettings from '@app/hooks/useSettings';
import { Permission, useUser } from '@app/hooks/useUser';
import defineMessages from '@app/utils/defineMessages';
import { ChevronRightIcon } from '@heroicons/react/20/solid';
import {
  ExclamationTriangleIcon,
  InformationCircleIcon,
} from '@heroicons/react/24/solid';
import { MediaRequestStatus, MediaStatus } from '@server/constants/media';
import { MediaServerType } from '@server/constants/server';
import type Media from '@server/entity/Media';
import { DiagnosisCategory } from '@server/lib/diagnostics/types';
import { useState } from 'react';
import { useIntl } from 'react-intl';

const messages = defineMessages('components.RequestDiagnosis', {
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
        className={`mb-6 flex flex-col gap-3 rounded-md border p-4 backdrop-blur sm:flex-row sm:items-center ${
          attention
            ? 'border-yellow-500 bg-yellow-400/20'
            : 'border-indigo-500 bg-indigo-400/20'
        }`}
      >
        <div className="flex flex-1">
          <div
            className={`flex-shrink-0 ${
              attention ? 'text-yellow-100' : 'text-gray-100'
            }`}
          >
            <Icon className="h-5 w-5" />
          </div>
          <div className="ml-3 text-sm">
            <div
              className={`font-medium ${
                attention ? 'text-yellow-100' : 'text-gray-100'
              }`}
            >
              {text.headline}
            </div>
            <div
              className={`mt-1 ${
                attention ? 'text-yellow-300' : 'text-gray-300'
              }`}
            >
              {text.body[0]}
            </div>
          </div>
        </div>
        <Button
          buttonType={attention ? 'warning' : 'primary'}
          buttonSize="sm"
          className="ml-8 flex-shrink-0 sm:ml-0"
          onClick={() => setOpen(true)}
        >
          <span>{intl.formatMessage(messages.details)}</span>
          <ChevronRightIcon />
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
