import Button from '@app/components/Common/Button';
import useToasts from '@app/hooks/useToasts';
import { Permission, useUser } from '@app/hooks/useUser';
import defineMessages from '@app/utils/defineMessages';
import {
  ArrowPathIcon,
  CheckIcon,
  XMarkIcon,
} from '@heroicons/react/24/outline';
import {
  CheckCircleIcon,
  ClockIcon,
  InformationCircleIcon,
  XCircleIcon,
} from '@heroicons/react/24/solid';
import { MediaType } from '@server/constants/media';
import type Issue from '@server/entity/Issue';
import axios from 'axios';
import { useState } from 'react';
import { useIntl } from 'react-intl';

const messages = defineMessages('components.IssueDetails.IssueReplacement', {
  replace: 'Replace File',
  replaceAgain: 'Replace Again',
  askAgain: 'Ask Again',
  approve: 'Approve & Replace',
  decline: 'Decline',
  retry: 'Try Again',
  what: 'Deletes the file, blocklists the release it came from and downloads a different one.',
  pendingHead: 'Replacement waiting for an admin',
  pendingBody:
    '{name} asked to delete the file, blocklist its release and download a different one.',
  completedHead: 'File replaced',
  completedBody:
    '{files, plural, =0 {There was no file to delete} one {Deleted # file} other {Deleted # files}}{releases, plural, =0 {} other {, blocklisted {list}}}, and searching for a different release.',
  noHistory:
    '{count, plural, one {# file was} other {# files were}} imported by hand, so there was no release to blocklist and the same one could come back.',
  approvedBy: 'Approved by {name}.',
  autoApproved: 'Ran without approval.',
  failedHead: "Couldn't replace the file",
  declinedHead: 'Replacement declined',
  declinedBody: '{name} declined it.',
  failed: 'Something went wrong. Try again later.',
});

const IssueReplacement = ({
  issue,
  onChange,
}: {
  issue: Issue;
  onChange: () => void;
}) => {
  const intl = useIntl();
  const { addToast } = useToasts();
  const { user, hasPermission } = useUser();
  const [busy, setBusy] = useState(false);
  const replacement = issue.replacement;
  const isAdmin = hasPermission(Permission.ADMIN);
  const canAsk =
    (issue.createdBy.id === user?.id ||
      hasPermission(Permission.MANAGE_ISSUES)) &&
    (issue.media.mediaType === MediaType.MOVIE || issue.problemSeason > 0);

  const act = async (action: 'request' | 'approve' | 'decline') => {
    setBusy(true);
    try {
      await axios.post(`/api/v1/issue/${issue.id}/replacement`, { action });
      onChange();
    } catch (e) {
      addToast(
        e.response?.data?.message ?? intl.formatMessage(messages.failed),
        { appearance: 'error', autoDismiss: true }
      );
    } finally {
      setBusy(false);
    }
  };

  if (!replacement) {
    if (!canAsk) return null;
    return (
      <div className="mt-4 flex flex-col gap-2 sm:flex-row sm:items-center">
        <Button
          buttonType="ghost"
          buttonSize="sm"
          disabled={busy}
          onClick={() => act('request')}
        >
          <ArrowPathIcon />
          <span>{intl.formatMessage(messages.replace)}</span>
        </Button>
        <span className="text-sm text-gray-400">
          {intl.formatMessage(messages.what)}
        </span>
      </div>
    );
  }

  const { status } = replacement;
  const tone = {
    pending: {
      box: 'border-yellow-500 bg-yellow-400/20',
      head: 'text-yellow-100',
      body: 'text-yellow-300',
      Icon: ClockIcon,
    },
    completed: {
      box: 'border-green-500 bg-green-400/20',
      head: 'text-green-100',
      body: 'text-green-300',
      Icon: CheckCircleIcon,
    },
    failed: {
      box: 'border-red-500 bg-red-400/20',
      head: 'text-red-100',
      body: 'text-red-300',
      Icon: XCircleIcon,
    },
    declined: {
      box: 'border-gray-600 bg-gray-700/40',
      head: 'text-gray-100',
      body: 'text-gray-300',
      Icon: InformationCircleIcon,
    },
  }[status];
  const decider = replacement.decidedBy?.displayName ?? '';

  let headline: string;
  let body: React.ReactNode;
  if (status === 'pending') {
    headline = intl.formatMessage(messages.pendingHead);
    body = intl.formatMessage(messages.pendingBody, {
      name: issue.createdBy.displayName,
    });
  } else if (status === 'completed') {
    const releases = replacement.blocklisted ?? [];
    headline = intl.formatMessage(messages.completedHead);
    body = (
      <>
        {intl.formatMessage(messages.completedBody, {
          files: replacement.deletedFiles ?? 0,
          releases: releases.length,
          list: intl.formatList(releases),
        })}
        {!!replacement.notBlocklisted && (
          <span className="mt-1 block">
            {intl.formatMessage(messages.noHistory, {
              count: replacement.notBlocklisted,
            })}
          </span>
        )}
        <span className="mt-1 block text-xs opacity-80">
          {replacement.autoApproved
            ? intl.formatMessage(messages.autoApproved)
            : intl.formatMessage(messages.approvedBy, { name: decider })}
        </span>
      </>
    );
  } else if (status === 'failed') {
    headline = intl.formatMessage(messages.failedHead);
    body = replacement.error;
  } else {
    headline = intl.formatMessage(messages.declinedHead);
    body = intl.formatMessage(messages.declinedBody, { name: decider });
  }

  return (
    <div
      className={`mt-4 flex flex-col gap-3 rounded-md border p-4 backdrop-blur sm:flex-row sm:items-center ${tone.box}`}
    >
      <div className="flex flex-1">
        <div className={`flex-shrink-0 ${tone.head}`}>
          <tone.Icon className="h-5 w-5" />
        </div>
        <div className="ml-3 min-w-0 text-sm">
          <div className={`font-medium ${tone.head}`}>{headline}</div>
          <div className={`mt-1 break-words ${tone.body}`}>{body}</div>
        </div>
      </div>
      <div className="ml-8 flex flex-shrink-0 gap-2 sm:ml-0">
        {isAdmin && (status === 'pending' || status === 'failed') && (
          <Button
            buttonType="warning"
            buttonSize="sm"
            disabled={busy}
            onClick={() => act('approve')}
          >
            {status === 'pending' ? <CheckIcon /> : <ArrowPathIcon />}
            <span>
              {intl.formatMessage(
                status === 'pending' ? messages.approve : messages.retry
              )}
            </span>
          </Button>
        )}
        {isAdmin && status === 'pending' && (
          <Button
            buttonType="ghost"
            buttonSize="sm"
            disabled={busy}
            onClick={() => act('decline')}
          >
            <XMarkIcon />
            <span>{intl.formatMessage(messages.decline)}</span>
          </Button>
        )}
        {canAsk &&
          (status === 'completed' ||
            status === 'declined' ||
            (status === 'failed' && !isAdmin)) && (
            <Button
              buttonType="ghost"
              buttonSize="sm"
              disabled={busy}
              onClick={() => act('request')}
            >
              <ArrowPathIcon />
              <span>
                {intl.formatMessage(
                  status === 'declined'
                    ? messages.askAgain
                    : status === 'failed'
                      ? messages.retry
                      : messages.replaceAgain
                )}
              </span>
            </Button>
          )}
      </div>
    </div>
  );
};

export default IssueReplacement;
