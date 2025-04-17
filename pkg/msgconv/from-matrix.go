// mautrix-meta - A Matrix-Facebook Messenger and Instagram DM puppeting bridge.
// Copyright (C) 2024 Tulir Asokan
//
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU Affero General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.
//
// This program is distributed in the hope that it will be useful,
// but WITHOUT ANY WARRANTY; without even the implied warranty of
// MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
// GNU Affero General Public License for more details.
//
// You should have received a copy of the GNU Affero General Public License
// along with this program.  If not, see <https://www.gnu.org/licenses/>.

package msgconv

import (
	"context"
	"fmt"
	"net/http"
	"strings"
	"time"

	"github.com/rs/zerolog"
	"go.mau.fi/util/ffmpeg"
	"go.mau.fi/util/random"
	"maunium.net/go/mautrix/bridgev2"
	"maunium.net/go/mautrix/bridgev2/database"
	"maunium.net/go/mautrix/event"
	"maunium.net/go/mautrix/format"
	"maunium.net/go/mautrix/id"

	"go.mau.fi/mautrix-meta/pkg/messagix"
	"go.mau.fi/mautrix-meta/pkg/messagix/methods"
	"go.mau.fi/mautrix-meta/pkg/messagix/socket"
	"go.mau.fi/mautrix-meta/pkg/messagix/table"
	"go.mau.fi/mautrix-meta/pkg/messagix/types"
	"go.mau.fi/mautrix-meta/pkg/metaid"
)

func (mc *MessageConverter) ToMeta(
	ctx context.Context,
	client *messagix.Client,
	evt *event.Event,
	content *event.MessageEventContent,
	replyTo *database.Message,
	threadRoot *database.Message,
	relaybotFormatted bool,
	portal *bridgev2.Portal,
) ([]socket.Task, int64, error) {
	if evt.Type == event.EventSticker {
		content.MsgType = event.MsgImage
	}

	threadID := metaid.ParseFBPortalID(portal.ID)
	task := &socket.SendMessageTask{
		ThreadId:         threadID,
		Otid:             methods.GenerateEpochID(),
		Source:           table.MESSENGER_INBOX_IN_THREAD,
		InitiatingSource: table.FACEBOOK_INBOX,
		SendType:         table.TEXT,
		SyncGroup:        1,
	}
	if portal.Metadata.(*metaid.PortalMetadata).ThreadType == table.COMMUNITY_GROUP {
		task.SyncGroup = 104
		if threadRoot != nil {
			parsed, _ := metaid.ParseMessageID(threadRoot.ID).(metaid.ParsedFBMessageID)
			thread, err := mc.DB.GetThreadByMessage(ctx, parsed.ID)
			if err != nil {
				zerolog.Ctx(ctx).Err(err).
					Stringer("thread_root_mxid", threadRoot.MXID).
					Str("thread_root_parsed_id", parsed.ID).
					Msg("Failed to get thread by message")
			} else if thread == 0 {
				zerolog.Ctx(ctx).Warn().
					Stringer("thread_root_mxid", threadRoot.MXID).
					Str("thread_root_parsed_id", parsed.ID).
					Msg("Thread not found")
			} else {
				zerolog.Ctx(ctx).Trace().
					Stringer("thread_root_mxid", threadRoot.MXID).
					Str("thread_root_parsed_id", parsed.ID).
					Int64("subthread_key", thread).
					Msg("Thread found")
				task.ThreadId = thread
			}
		}
	}
	if replyTo != nil {
		msgID, ok := metaid.ParseMessageID(replyTo.ID).(metaid.ParsedFBMessageID)
		if ok {
			task.ReplyMetaData = &socket.ReplyMetaData{
				ReplyMessageId:  msgID.ID,
				ReplySourceType: 1,
				ReplyType:       0,
				ReplySender:     metaid.ParseUserID(replyTo.SenderID),
			}
		} // TODO log warning in else case?
	}
	if content.MsgType == event.MsgEmote && !relaybotFormatted {
		content.Body = "/me " + content.Body
		if content.FormattedBody != "" {
			content.FormattedBody = "/me " + content.FormattedBody
		}
	}
	switch content.MsgType {
	case event.MsgText, event.MsgNotice, event.MsgEmote:
		if content.Format == event.FormatHTML {
			mc.parseFormattedBody(ctx, content, task, portal)
		} else {
			task.Text = content.Body
		}
	case event.MsgImage, event.MsgVideo, event.MsgAudio, event.MsgFile:
		resp, err := mc.reuploadFileToMeta(ctx, client, portal, content)
		if err != nil {
			return nil, 0, err
		}
		attachmentID := resp.Payload.RealMetadata.GetFbId()
		if attachmentID == 0 {
			zerolog.Ctx(ctx).Warn().RawJSON("response", resp.Raw).Msg("No fbid received for upload")
			return nil, 0, fmt.Errorf("failed to upload attachment: fbid not received")
		}
		task.SendType = table.MEDIA
		task.AttachmentFBIds = []int64{attachmentID}
		if content.FileName != "" && content.Body != content.FileName {
			// This might not actually be allowed
			task.Text = content.Body
		}
	case event.MsgLocation:
		// TODO implement
		fallthrough
	default:
		return nil, 0, fmt.Errorf("%w %s", bridgev2.ErrUnsupportedMessageType, content.MsgType)
	}
	readTask := &socket.ThreadMarkReadTask{
		ThreadId:  task.ThreadId,
		SyncGroup: 1,

		LastReadWatermarkTs: time.Now().UnixMilli(),
	}
	return []socket.Task{task, readTask}, task.Otid, nil
}

const mentionLocator = "meta_mention_"

type MetaMention struct {
	Locator string
	Name    string
	UserID  int64
}

func NewMetaMention(userID int64, name string) *MetaMention {
	return &MetaMention{
		Locator: mentionLocator + random.String(16),
		Name:    name,
		UserID:  userID,
	}
}

func (mc *MessageConverter) convertPill(displayname, mxid, eventID string, ctx format.Context) string {
	if len(mxid) == 0 || mxid[0] != '@' {
		return format.DefaultPillConverter(displayname, mxid, eventID, ctx)
	}
	var userID int64
	var username string
	ghost, err := mc.Bridge.GetGhostByMXID(ctx.Ctx, id.UserID(mxid))
	if err != nil {
		zerolog.Ctx(ctx.Ctx).Err(err).Str("mxid", mxid).Msg("Failed to get user for mention")
		return displayname
	} else if ghost != nil {
		username = ghost.Metadata.(*metaid.GhostMetadata).Username
		if username == "" {
			username = ghost.Name
		}
		userID = metaid.ParseUserID(ghost.ID)
	} else if user, err := mc.Bridge.GetExistingUserByMXID(ctx.Ctx, id.UserID(mxid)); err != nil {
		zerolog.Ctx(ctx.Ctx).Err(err).Str("mxid", mxid).Msg("Failed to get user for mention")
		return displayname
	} else if user != nil {
		portal := ctx.ReturnData["portal"].(*bridgev2.Portal)
		login, _, _ := portal.FindPreferredLogin(ctx.Ctx, user, false)
		if login == nil {
			return displayname
		}
		userID = metaid.ParseUserLoginID(login.ID)
		if login.Metadata.(*metaid.UserLoginMetadata).Platform.IsMessenger() || login.RemoteProfile.Username == "" {
			username = login.RemoteProfile.Name
		} else {
			username = login.RemoteProfile.Username
		}
	} else {
		return displayname
	}
	mention := NewMetaMention(userID, username)
	mentions := ctx.ReturnData["mentions"].(*[]*MetaMention)
	*mentions = append(*mentions, mention)
	return mention.Locator
}

func (mc *MessageConverter) parseFormattedBody(ctx context.Context, content *event.MessageEventContent, task *socket.SendMessageTask, portal *bridgev2.Portal) {
	mentions := make([]*MetaMention, 0)

	parseCtx := format.NewContext(ctx)
	parseCtx.ReturnData["mentions"] = &mentions
	parseCtx.ReturnData["portal"] = portal
	parsed := mc.HTMLParser.Parse(content.FormattedBody, parseCtx)

	var socketMentions socket.Mentions

	for _, mention := range mentions {
		mentionIndex := strings.Index(parsed, mention.Locator)
		if mentionIndex == -1 {
			zerolog.Ctx(ctx).Warn().Any("mention", mention).Msg("Mention not found in parsed body")
			continue
		}

		parsed = parsed[:mentionIndex] + "@" + mention.Name + parsed[mentionIndex+len(mention.Locator):]

		socketMentions = append(socketMentions, socket.Mention{
			ID:     mention.UserID,
			Offset: mentionIndex,
			Length: len("@" + mention.Name),
			Type:   socket.MentionTypePerson,
		})
	}

	task.MentionData = socketMentions.ToData()
	task.Text = parsed
}

func (mc *MessageConverter) reuploadFileToMeta(ctx context.Context, client *messagix.Client, portal *bridgev2.Portal, content *event.MessageEventContent) (*types.MercuryUploadResponse, error) {
	threadID := metaid.ParseFBPortalID(portal.ID)
	mime := content.Info.MimeType
	fileName := content.Body
	if content.FileName != "" {
		fileName = content.FileName
	}
	data, err := mc.Bridge.Bot.DownloadMedia(ctx, content.URL, content.File)
	if err != nil {
		return nil, fmt.Errorf("%w: %w", bridgev2.ErrMediaDownloadFailed, err)
	}
	if mime == "" {
		mime = http.DetectContentType(data)
	}
	isVoice := content.MSC3245Voice != nil
	if isVoice && ffmpeg.Supported() {
		data, err = ffmpeg.ConvertBytes(ctx, data, ".m4a", []string{}, []string{"-c:a", "aac"}, mime)
		if err != nil {
			return nil, fmt.Errorf("%w (ogg to m4a): %w", bridgev2.ErrMediaConvertFailed, err)
		}
		mime = "audio/mp4"
		fileName += ".m4a"
	}
	resp, err := client.SendMercuryUploadRequest(ctx, threadID, &messagix.MercuryUploadMedia{
		Filename:    fileName,
		MimeType:    mime,
		MediaData:   data,
		IsVoiceClip: isVoice,
	})
	if err != nil {
		zerolog.Ctx(ctx).Debug().
			Str("file_name", fileName).
			Str("mime_type", mime).
			Bool("is_voice_clip", isVoice).
			Msg("Failed upload metadata")
		return nil, fmt.Errorf("%w: %w", bridgev2.ErrMediaReuploadFailed, err)
	}
	return resp, nil
}
