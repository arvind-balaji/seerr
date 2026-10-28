import Alert from '@app/components/Common/Alert';
import Badge from '@app/components/Common/Badge';
import Button from '@app/components/Common/Button';
import CachedImage from '@app/components/Common/CachedImage';
import Header from '@app/components/Common/Header';
import LoadingSpinner from '@app/components/Common/LoadingSpinner';
import PageTitle from '@app/components/Common/PageTitle';
import {
  ago,
  messages as labels,
  shortDate,
} from '@app/components/LibraryCleanup/labels';
import { formatBytes } from '@app/components/RequestDiagnosis/labels';
import useToasts from '@app/hooks/useToasts';
import { Permission, useUser } from '@app/hooks/useUser';
import ErrorPage from '@app/pages/_error';
import defineMessages from '@app/utils/defineMessages';
import {
  BookmarkIcon,
  BookmarkSlashIcon,
  FunnelIcon,
  ShieldCheckIcon,
  ShieldExclamationIcon,
} from '@heroicons/react/24/outline';
import type {
  CleanupAction,
  CleanupItem,
  CleanupResponse,
} from '@server/lib/cleanup/types';
import axios from 'axios';
import Link from 'next/link';
import { useState } from 'react';
import { useIntl } from 'react-intl';
import useSWR from 'swr';

const messages = defineMessages('components.LibraryCleanup.LeavingSoon', {
  leavingSoon: 'Leaving Soon',
  intro:
    'Titles nobody has watched in a while are removed to free up space. Keep anything you still want to watch; you can keep {max} at a time, each for {days} days.',
  introManager:
    'Titles nobody has watched in a while are announced here {grace} days before they are removed.',
  filterLeaving: 'Leaving Soon',
  filterNext: 'Next in Line',
  filterKept: 'Kept',
  filterProtected: 'Protected',
  filterRemoved: 'Recently Removed',
  emptyLeaving: 'Nothing is leaving right now.',
  emptyNext: 'Nothing qualifies for removal right now.',
  emptyKept: 'Nobody has kept anything.',
  emptyProtected: 'Nothing is protected.',
  emptyRemoved: 'Nothing has been removed yet.',
  modeOff: 'Library cleanup is off. Turn it on in Settings.',
  modePreview:
    'Preview mode: nothing is marked or removed. Next in Line shows what a live run would pick.',
  disk: 'Disk',
  diskUsage: '{used}% used · titles start leaving at {threshold}%',
  diskError: "Can't read {path}: {error}",
  lastRun: 'Last run',
  lastRunSummary:
    '{time} · {marked} marked · {removed} removed · {released} released',
  lastRunPreview: '{time} · a live run would mark {count}',
  never: 'Not yet',
  nextError: "Couldn't check the library: {error}",
  status: 'Status',
  lastWatched: 'Last watched',
  neverWatched: 'Never',
  size: 'Size',
  requestedBy: 'Requested by',
  removed: 'Removed {date}',
  protectedSince: 'Protected',
  nextInLine: 'Next in line',
  settings: 'Cleanup Settings',
});

type Filter = 'leaving' | 'next' | 'kept' | 'protected' | 'removed';

const LeavingSoon = () => {
  const intl = useIntl();
  const { hasPermission } = useUser();
  const isManager = hasPermission(Permission.MANAGE_REQUESTS);
  const isAdmin = hasPermission(Permission.ADMIN);
  const [filter, setFilter] = useState<Filter>('leaving');
  const { data, error, mutate } = useSWR<CleanupResponse>('/api/v1/cleanup');

  if (error) return <ErrorPage statusCode={500} />;
  if (!data) return <LoadingSpinner />;

  const m = data.manager;
  const lists: Record<Filter, CleanupItem[]> = {
    leaving: data.leaving,
    next: m?.nextInLine ?? [],
    kept: m?.kept ?? [],
    protected: m?.protected ?? [],
    removed: m?.removed ?? [],
  };
  const empty: Record<Filter, keyof typeof messages> = {
    leaving: 'emptyLeaving',
    next: 'emptyNext',
    kept: 'emptyKept',
    protected: 'emptyProtected',
    removed: 'emptyRemoved',
  };
  const items = lists[filter];

  return (
    <>
      <PageTitle title={intl.formatMessage(messages.leavingSoon)} />
      <div className="mb-4 flex flex-col justify-between lg:flex-row lg:items-end">
        <Header>{intl.formatMessage(messages.leavingSoon)}</Header>
        {m && (
          <div className="mt-2 flex flex-grow flex-col sm:flex-row lg:flex-grow-0">
            <div className="mb-2 flex flex-grow sm:mb-0 sm:mr-2 lg:flex-grow-0">
              <span className="inline-flex cursor-default items-center rounded-l-md border border-r-0 border-gray-500 bg-gray-800 px-3 text-sm text-gray-100">
                <FunnelIcon className="h-6 w-6" />
              </span>
              <select
                id="filter"
                name="filter"
                value={filter}
                onChange={(e) => setFilter(e.target.value as Filter)}
                className="rounded-r-only"
              >
                {(
                  [
                    ['leaving', 'filterLeaving'],
                    ['next', 'filterNext'],
                    ['kept', 'filterKept'],
                    ['protected', 'filterProtected'],
                    ['removed', 'filterRemoved'],
                  ] as const
                ).map(([value, label]) => (
                  <option key={value} value={value}>
                    {intl.formatMessage(messages[label])} ({lists[value].length}
                    )
                  </option>
                ))}
              </select>
            </div>
          </div>
        )}
      </div>

      <p className="mb-4 text-sm text-gray-400">
        {m
          ? intl.formatMessage(messages.introManager, { grace: data.graceDays })
          : intl.formatMessage(messages.intro, {
              max: data.maxKeepsPerUser,
              days: data.keepDays,
            })}
      </p>

      {isManager && data.mode === 'off' && (
        <Alert type="info" title={intl.formatMessage(messages.modeOff)} />
      )}
      {m && data.mode === 'preview' && (
        <Alert type="info" title={intl.formatMessage(messages.modePreview)} />
      )}
      {m?.nextInLineError && (
        <Alert
          type="error"
          title={intl.formatMessage(messages.nextError, {
            error: m.nextInLineError,
          })}
        />
      )}

      {m && (
        <div className="mb-6 grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div className="rounded-xl bg-gray-800 p-4 text-sm text-gray-300 shadow-md ring-1 ring-gray-700">
            <div className="mb-2 font-bold text-white">
              {intl.formatMessage(messages.disk)}
            </div>
            {m.disk.usedPercent !== undefined ? (
              <>
                <div className="relative mb-2 h-2 overflow-hidden rounded-full bg-gray-700">
                  <div
                    className={`h-2 ${
                      m.disk.usedPercent >= m.maxUsedPercent
                        ? 'bg-yellow-500'
                        : 'bg-indigo-500'
                    }`}
                    style={{ width: `${Math.min(m.disk.usedPercent, 100)}%` }}
                  />
                  <div
                    className="absolute top-0 h-2 w-0.5 bg-white"
                    style={{ left: `${m.maxUsedPercent}%` }}
                  />
                </div>
                {intl.formatMessage(messages.diskUsage, {
                  used: m.disk.usedPercent,
                  threshold: m.maxUsedPercent,
                })}
              </>
            ) : (
              intl.formatMessage(messages.diskError, {
                path: m.disk.path,
                error: m.disk.error,
              })
            )}
          </div>
          <div className="flex flex-col justify-between rounded-xl bg-gray-800 p-4 text-sm text-gray-300 shadow-md ring-1 ring-gray-700">
            <div>
              <div className="mb-2 font-bold text-white">
                {intl.formatMessage(messages.lastRun)}
              </div>
              {!m.lastRun
                ? intl.formatMessage(messages.never)
                : m.lastRun.mode === 'preview'
                  ? intl.formatMessage(messages.lastRunPreview, {
                      time: ago(intl, m.lastRun.at),
                      count: m.lastRun.wouldMark?.length ?? 0,
                    })
                  : intl.formatMessage(messages.lastRunSummary, {
                      time: ago(intl, m.lastRun.at),
                      marked: m.lastRun.marked,
                      removed: m.lastRun.removed,
                      released: m.lastRun.released,
                    })}
            </div>
            {isAdmin && (
              <div className="mt-3">
                <Link href="/settings/cleanup">
                  <Button buttonType="ghost" buttonSize="sm">
                    {intl.formatMessage(messages.settings)}
                  </Button>
                </Link>
              </div>
            )}
          </div>
        </div>
      )}

      {items.length === 0 ? (
        <div className="flex w-full flex-col items-center justify-center py-24 text-white">
          <span className="text-2xl text-gray-400">
            {intl.formatMessage(messages[empty[filter]])}
          </span>
        </div>
      ) : (
        items.map((item) => (
          <div className="py-2" key={item.mediaId}>
            <CleanupItemCard
              item={item}
              filter={filter}
              isManager={isManager}
              canKeep={
                isManager ||
                (hasPermission([Permission.REQUEST], { type: 'or' }) &&
                  data.myKeeps < data.maxKeepsPerUser)
              }
              keepDays={data.keepDays}
              onChange={() => mutate()}
            />
          </div>
        ))
      )}
    </>
  );
};

const CleanupItemCard = ({
  item,
  filter,
  isManager,
  canKeep,
  keepDays,
  onChange,
}: {
  item: CleanupItem;
  filter: Filter;
  isManager: boolean;
  canKeep: boolean;
  keepDays: number;
  onChange: () => void;
}) => {
  const intl = useIntl();
  const { addToast } = useToasts();
  const [busy, setBusy] = useState(false);
  const href = `/${item.mediaType}/${item.tmdbId}`;
  const reason = item.candidate?.reason ?? item.cleanup?.reason;
  const cleanup = item.cleanup;

  const act = async (action: CleanupAction) => {
    setBusy(true);
    try {
      await axios.post(`/api/v1/media/${item.mediaId}/cleanup`, { action });
      if (action === 'keep') {
        addToast(intl.formatMessage(labels.kept, { days: keepDays }), {
          appearance: 'success',
          autoDismiss: true,
        });
      }
      onChange();
    } catch (e) {
      addToast(e.response?.data?.message ?? intl.formatMessage(labels.failed), {
        appearance: 'error',
        autoDismiss: true,
      });
    } finally {
      setBusy(false);
    }
  };

  let status: React.ReactNode;
  switch (filter) {
    case 'leaving':
      status = (
        <Badge badgeType="warning">
          {intl.formatMessage(labels.leavingBadge, {
            date: shortDate(intl, cleanup?.removeAt ?? ''),
          })}
        </Badge>
      );
      break;
    case 'next':
      status = (
        <Badge badgeType="primary">
          {intl.formatMessage(messages.nextInLine)}
        </Badge>
      );
      break;
    case 'kept':
      status = (
        <Badge badgeType="success">
          {intl.formatMessage(labels.keptHead, {
            date: shortDate(intl, cleanup?.keptUntil ?? ''),
          })}
        </Badge>
      );
      break;
    case 'protected':
      status = (
        <Badge badgeType="success">
          {intl.formatMessage(messages.protectedSince)}
        </Badge>
      );
      break;
    case 'removed':
      status = (
        <Badge badgeType="danger">
          {intl.formatMessage(messages.removed, {
            date: shortDate(intl, cleanup?.since ?? ''),
          })}
        </Badge>
      );
      break;
  }

  return (
    <div className="relative flex w-full flex-col justify-between overflow-hidden rounded-xl bg-gray-800 py-4 text-gray-400 shadow-md ring-1 ring-gray-700 xl:h-28 xl:flex-row">
      {item.backdropPath && (
        <div className="absolute inset-0 z-0 w-full bg-cover bg-center xl:w-2/3">
          <CachedImage
            type="tmdb"
            src={`https://image.tmdb.org/t/p/w1920_and_h800_multi_faces/${item.backdropPath}`}
            alt=""
            style={{ width: '100%', height: '100%', objectFit: 'cover' }}
            fill
          />
          <div
            className="absolute inset-0"
            style={{
              backgroundImage:
                'linear-gradient(90deg, rgba(31, 41, 55, 0.47) 0%, rgba(31, 41, 55, 1) 100%)',
            }}
          />
        </div>
      )}
      <div className="relative flex w-full flex-col justify-between overflow-hidden sm:flex-row">
        <div className="relative z-10 flex w-full items-center overflow-hidden pl-4 pr-4 sm:pr-0 xl:w-7/12 2xl:w-2/3">
          <Link
            href={href}
            className="relative h-auto w-12 flex-shrink-0 scale-100 transform-gpu overflow-hidden rounded-md transition duration-300 hover:scale-105"
          >
            <CachedImage
              type="tmdb"
              src={
                item.posterPath
                  ? `https://image.tmdb.org/t/p/w600_and_h900_bestv2${item.posterPath}`
                  : '/images/seerr_poster_not_found.png'
              }
              alt=""
              sizes="100vw"
              style={{ width: '100%', height: 'auto', objectFit: 'cover' }}
              width={600}
              height={900}
            />
          </Link>
          <div className="flex flex-col justify-center overflow-hidden pl-2 xl:pl-4">
            <div className="pt-0.5 text-xs font-medium text-white sm:pt-1">
              {item.year}
            </div>
            <Link href={href}>
              <span className="mr-2 min-w-0 truncate text-lg font-bold text-white hover:underline xl:text-xl">
                {item.title}
              </span>
            </Link>
          </div>
        </div>

        <div className="z-10 ml-4 mt-4 flex w-full flex-col justify-center overflow-hidden pr-4 text-sm sm:ml-2 sm:mt-0 xl:flex-1 xl:pr-0">
          <div className="card-field">
            <span className="card-field-name">
              {intl.formatMessage(messages.status)}
            </span>
            {status}
          </div>
          {reason && filter !== 'protected' && (
            <div className="card-field">
              <span className="card-field-name">
                {intl.formatMessage(messages.lastWatched)}
              </span>
              <span className="flex truncate text-sm text-gray-300">
                {reason.lastWatchedAt
                  ? ago(intl, reason.lastWatchedAt)
                  : intl.formatMessage(messages.neverWatched)}
              </span>
            </div>
          )}
          {isManager && reason && filter !== 'protected' && (
            <div className="card-field">
              <span className="card-field-name">
                {intl.formatMessage(messages.size)}
              </span>
              <span className="flex truncate text-sm text-gray-300">
                {formatBytes(intl, reason.sizeBytes)}
              </span>
            </div>
          )}
          {isManager && (item.requestedBy ?? []).length > 0 && (
            <div className="card-field">
              <span className="card-field-name">
                {intl.formatMessage(messages.requestedBy)}
              </span>
              <span className="flex truncate text-sm text-gray-300">
                {item.requestedBy?.map((u) => u.displayName).join(', ')}
              </span>
            </div>
          )}
        </div>
      </div>
      <div className="z-10 mt-4 flex w-full flex-col justify-center space-y-2 pl-4 pr-4 xl:mt-0 xl:w-96 xl:items-end xl:pl-0">
        {filter === 'leaving' && (
          <Button
            buttonType="warning"
            buttonSize="sm"
            className="w-full xl:w-auto"
            disabled={busy || !canKeep}
            onClick={() => act('keep')}
          >
            <BookmarkIcon />
            <span>{intl.formatMessage(labels.keep)}</span>
          </Button>
        )}
        {filter === 'kept' && (
          <Button
            buttonType="ghost"
            buttonSize="sm"
            className="w-full xl:w-auto"
            disabled={busy}
            onClick={() => act('unkeep')}
          >
            <BookmarkSlashIcon />
            <span>{intl.formatMessage(labels.undoKeep)}</span>
          </Button>
        )}
        {isManager && ['leaving', 'next', 'kept'].includes(filter) && (
          <Button
            buttonType="ghost"
            buttonSize="sm"
            className="w-full xl:w-auto"
            disabled={busy}
            onClick={() => act('protect')}
          >
            <ShieldCheckIcon />
            <span>{intl.formatMessage(labels.protect)}</span>
          </Button>
        )}
        {isManager && filter === 'protected' && (
          <Button
            buttonType="ghost"
            buttonSize="sm"
            className="w-full xl:w-auto"
            disabled={busy}
            onClick={() => act('unprotect')}
          >
            <ShieldExclamationIcon />
            <span>{intl.formatMessage(labels.unprotect)}</span>
          </Button>
        )}
      </div>
    </div>
  );
};

export default LeavingSoon;
