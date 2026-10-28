import Button from '@app/components/Common/Button';
import {
  leavingReason,
  messages,
  shortDate,
} from '@app/components/LibraryCleanup/labels';
import useToasts from '@app/hooks/useToasts';
import { Permission, useUser } from '@app/hooks/useUser';
import {
  BookmarkIcon,
  BookmarkSlashIcon,
  ShieldCheckIcon,
  ShieldExclamationIcon,
} from '@heroicons/react/24/outline';
import {
  ExclamationTriangleIcon,
  InformationCircleIcon,
} from '@heroicons/react/24/solid';
import type Media from '@server/entity/Media';
import type { CleanupAction, CleanupResponse } from '@server/lib/cleanup/types';
import axios from 'axios';
import { useState } from 'react';
import { useIntl } from 'react-intl';
import useSWR from 'swr';

/** Leaving Soon, kept or protected: shown on title pages. */
const CleanupCallout = ({
  media,
  onChange,
}: {
  media?: Media;
  onChange?: () => void;
}) => {
  const intl = useIntl();
  const { addToast } = useToasts();
  const { user, hasPermission } = useUser();
  const [busy, setBusy] = useState(false);
  const cleanup = media?.cleanup;
  const isManager = hasPermission(Permission.MANAGE_REQUESTS);
  const { data: status, mutate } = useSWR<CleanupResponse>(
    cleanup ? '/api/v1/cleanup?summary=1' : null
  );

  if (!media || !cleanup || !status || status.mode === 'off') return null;
  const { state } = cleanup;
  if (state === 'removed' || (state === 'protected' && !isManager)) {
    return null;
  }

  const act = async (action: CleanupAction) => {
    setBusy(true);
    try {
      await axios.post(`/api/v1/media/${media.id}/cleanup`, { action });
      if (action === 'keep') {
        addToast(intl.formatMessage(messages.kept, { days: status.keepDays }), {
          appearance: 'success',
          autoDismiss: true,
        });
      }
      mutate();
      onChange?.();
    } catch (e) {
      addToast(
        e.response?.data?.message ?? intl.formatMessage(messages.failed),
        {
          appearance: 'error',
          autoDismiss: true,
        }
      );
    } finally {
      setBusy(false);
    }
  };

  const keepsLeft = Math.max(status.maxKeepsPerUser - status.myKeeps, 0);
  const canKeep =
    hasPermission([Permission.REQUEST], { type: 'or' }) &&
    (isManager || keepsLeft > 0);
  const leaving = state === 'leaving';
  const Icon = leaving ? ExclamationTriangleIcon : InformationCircleIcon;

  let headline: string;
  let body: string;
  if (leaving) {
    headline = intl.formatMessage(messages.leavingHead, {
      date: shortDate(intl, cleanup.removeAt ?? cleanup.since),
    });
    body = leavingReason(intl, cleanup);
  } else if (state === 'kept') {
    headline = intl.formatMessage(messages.keptHead, {
      date: shortDate(intl, cleanup.keptUntil ?? cleanup.since),
    });
    body = intl.formatMessage(
      cleanup.userId === user?.id ? messages.keptByYou : messages.keptBySomeone
    );
  } else {
    headline = intl.formatMessage(messages.protectedHead);
    body = intl.formatMessage(messages.protectedBody);
  }

  const tip =
    leaving && !isManager
      ? keepsLeft > 0
        ? intl.formatMessage(messages.keepTip, {
            days: status.keepDays,
            left: keepsLeft,
          })
        : intl.formatMessage(messages.keepNoneLeft, {
            max: status.maxKeepsPerUser,
          })
      : undefined;

  return (
    <div
      className={`mb-6 flex flex-col gap-3 rounded-md border p-4 backdrop-blur sm:flex-row sm:items-center ${
        leaving
          ? 'border-yellow-500 bg-yellow-400/20'
          : 'border-indigo-500 bg-indigo-400/20'
      }`}
    >
      <div className="flex flex-1">
        <div
          className={`flex-shrink-0 ${
            leaving ? 'text-yellow-100' : 'text-gray-100'
          }`}
        >
          <Icon className="h-5 w-5" />
        </div>
        <div className="ml-3 text-sm">
          <div
            className={`font-medium ${
              leaving ? 'text-yellow-100' : 'text-gray-100'
            }`}
          >
            {headline}
          </div>
          <div
            className={`mt-1 ${leaving ? 'text-yellow-300' : 'text-gray-300'}`}
          >
            {body}
            {tip && (
              <span className="mt-1 block text-xs opacity-80">{tip}</span>
            )}
          </div>
        </div>
      </div>
      <div className="ml-8 flex flex-shrink-0 gap-2 sm:ml-0">
        {leaving && (
          <Button
            buttonType="warning"
            buttonSize="sm"
            disabled={busy || !canKeep}
            onClick={() => act('keep')}
          >
            <BookmarkIcon />
            <span>{intl.formatMessage(messages.keep)}</span>
          </Button>
        )}
        {state === 'kept' && (isManager || cleanup.userId === user?.id) && (
          <Button
            buttonType="ghost"
            buttonSize="sm"
            disabled={busy}
            onClick={() => act('unkeep')}
          >
            <BookmarkSlashIcon />
            <span>{intl.formatMessage(messages.undoKeep)}</span>
          </Button>
        )}
        {isManager && state !== 'protected' && (
          <Button
            buttonType="ghost"
            buttonSize="sm"
            disabled={busy}
            onClick={() => act('protect')}
          >
            <ShieldCheckIcon />
            <span>{intl.formatMessage(messages.protect)}</span>
          </Button>
        )}
        {isManager && state === 'protected' && (
          <Button
            buttonType="ghost"
            buttonSize="sm"
            disabled={busy}
            onClick={() => act('unprotect')}
          >
            <ShieldExclamationIcon />
            <span>{intl.formatMessage(messages.unprotect)}</span>
          </Button>
        )}
      </div>
    </div>
  );
};

export default CleanupCallout;
