import { useId, useState } from 'react';
import type { Hex } from 'viem';
import { collectTopics, filterByTopic } from '../feed';
import { useFeed } from '../hooks/useFeed';
import { decodeTopic, topicLabel } from '../text';
import { PostCard } from './PostCard';

function topicOptionLabel(topic: Hex): string {
  const decoded = decodeTopic(topic);
  return decoded.label === '' ? '(no topic)' : topicLabel(decoded);
}

export function Feed() {
  const feed = useFeed();
  const filterId = useId();
  const [topicFilter, setTopicFilter] = useState<Hex | null>(null);
  const posts = feed.snapshot?.posts ?? [];
  const topics = collectTopics(posts);
  const visible = filterByTopic(posts, topicFilter);
  const filterLabel = topicFilter === null ? null : topicOptionLabel(topicFilter);

  return (
    <section className="feed" aria-labelledby="feed-heading">
      <div className="feed-header">
        <h2 id="feed-heading">Feed</h2>
        <div className="feed-controls">
          <label htmlFor={filterId}>Topic</label>
          <select id={filterId} value={topicFilter ?? ''} onChange={(event) => setTopicFilter(event.target.value === '' ? null : (event.target.value as Hex))}>
            <option value="">All topics ({posts.length})</option>
            {topics.map(({ topic, count }) => (
              <option key={topic} value={topic}>
                {topicOptionLabel(topic)} ({count})
              </option>
            ))}
          </select>
          <button type="button" className="button button-secondary" onClick={() => feed.refresh()} disabled={feed.isFetching}>
            {feed.isFetching ? 'Refreshing…' : 'Refresh'}
          </button>
        </div>
      </div>
      <p className="notice">Posts are unmoderated user content, shown exactly as written. Nothing here is checked, endorsed or removable.</p>
      <p role="status" className="feed-status text-small text-secondary">
        {feed.isLoading
          ? 'Reading posts from the chain…'
          : feed.snapshot?.syncedBlock !== undefined && feed.snapshot?.syncedBlock !== null
            ? `Ranked by tips · ${posts.length} ${posts.length === 1 ? 'post' : 'posts'} · synced to block ${feed.snapshot.syncedBlock.toString()}`
            : ''}
      </p>
      {feed.error ? (
        <p role="alert" className="text-danger">
          Unable to read posts: {feed.error}{' '}
          <button type="button" className="button button-secondary button-inline" onClick={() => feed.refresh()}>
            Try again
          </button>
        </p>
      ) : null}
      {!feed.isLoading && posts.length === 0 && !feed.error ? (
        <div className="empty">
          <p className="empty-title">No posts yet</p>
          <p className="text-secondary">The first post on Soapbox costs 100 SOAP and stays forever. Write one in the form.</p>
        </div>
      ) : null}
      {posts.length > 0 && visible.length === 0 ? (
        <div className="empty">
          <p className="empty-title">No posts with topic “{filterLabel}”</p>
          <button type="button" className="button button-secondary" onClick={() => setTopicFilter(null)}>
            Show all topics
          </button>
        </div>
      ) : null}
      {visible.length > 0 ? (
        <ol className="post-list">
          {visible.map((post) => (
            <li key={post.id.toString()}>
              <PostCard post={post} />
            </li>
          ))}
        </ol>
      ) : null}
    </section>
  );
}
