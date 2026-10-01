package mpc

import (
	"bytes"
	"context"
	"errors"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"sort"
	"strings"

	"github.com/aws/aws-sdk-go-v2/aws"
	awsconfig "github.com/aws/aws-sdk-go-v2/config"
	"github.com/aws/aws-sdk-go-v2/service/s3"
	s3types "github.com/aws/aws-sdk-go-v2/service/s3/types"
)

// A BackupSink is somewhere encrypted backups are kept. Backups are already encrypted to the
// recovery key, so a sink needs durability and separation from the node, not secrecy: put
// them where losing the node's host does not lose them, ideally in a different account.
type BackupSink interface {
	Name() string
	Put(ctx context.Context, name string, data []byte) error
	Get(ctx context.Context, name string) ([]byte, error)
	List(ctx context.Context, prefix string) ([]string, error)
	Delete(ctx context.Context, name string) error
}

// ── Directory ─────────────────────────────────────────────────────────────────

// DirSink keeps backups in a directory — a mounted volume, an NFS export, a synced folder.
type DirSink struct{ Dir string }

func (d DirSink) Name() string { return "dir:" + d.Dir }

func (d DirSink) path(name string) (string, error) {
	clean := filepath.Clean(name)
	if strings.HasPrefix(clean, "..") || filepath.IsAbs(clean) {
		return "", errors.New("backup name escapes the backup directory")
	}
	return filepath.Join(d.Dir, clean), nil
}

func (d DirSink) Put(_ context.Context, name string, data []byte) error {
	p, err := d.path(name)
	if err != nil {
		return err
	}
	if err := os.MkdirAll(filepath.Dir(p), 0o700); err != nil {
		return err
	}
	tmp := p + ".tmp"
	if err := os.WriteFile(tmp, data, 0o600); err != nil {
		return err
	}
	return os.Rename(tmp, p) // atomic: a reader never sees half a backup
}

func (d DirSink) Get(_ context.Context, name string) ([]byte, error) {
	p, err := d.path(name)
	if err != nil {
		return nil, err
	}
	return os.ReadFile(p)
}

func (d DirSink) List(_ context.Context, prefix string) ([]string, error) {
	var out []string
	root := filepath.Join(d.Dir, filepath.Clean(prefix))
	entries, err := os.ReadDir(root)
	if os.IsNotExist(err) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	for _, e := range entries {
		if !e.IsDir() && strings.HasSuffix(e.Name(), ".mpcbackup") {
			out = append(out, filepath.ToSlash(filepath.Join(prefix, e.Name())))
		}
	}
	sort.Strings(out)
	return out, nil
}

func (d DirSink) Delete(_ context.Context, name string) error {
	p, err := d.path(name)
	if err != nil {
		return err
	}
	return os.Remove(p)
}

// ── S3 ────────────────────────────────────────────────────────────────────────

// S3Sink keeps backups in an S3 bucket. Use a bucket in a different account from the node,
// with versioning, and a policy that lets only a dedicated pruning role delete.
type S3Sink struct {
	client *s3.Client
	bucket string
	prefix string
	kmsKey string
}

// NewS3Sink builds a sink from the standard AWS configuration (region, credentials, and
// AWS_ENDPOINT_URL_S3 for a compatible store).
func NewS3Sink(ctx context.Context, bucket, prefix, kmsKey string) (*S3Sink, error) {
	if bucket == "" {
		return nil, errors.New("an S3 bucket name is required")
	}
	cfg, err := awsconfig.LoadDefaultConfig(ctx)
	if err != nil {
		return nil, err
	}
	custom := os.Getenv("AWS_ENDPOINT_URL_S3") != ""
	client := s3.NewFromConfig(cfg, func(o *s3.Options) { o.UsePathStyle = custom })
	return &S3Sink{client: client, bucket: bucket, prefix: strings.Trim(prefix, "/"), kmsKey: kmsKey}, nil
}

func (s *S3Sink) Name() string { return "s3:" + s.bucket + "/" + s.prefix }

func (s *S3Sink) key(name string) string {
	if s.prefix == "" {
		return name
	}
	return s.prefix + "/" + name
}

func (s *S3Sink) Put(ctx context.Context, name string, data []byte) error {
	in := &s3.PutObjectInput{Bucket: aws.String(s.bucket), Key: aws.String(s.key(name)), Body: bytes.NewReader(data), ContentType: aws.String("application/json")}
	if s.kmsKey != "" {
		in.ServerSideEncryption = s3types.ServerSideEncryptionAwsKms
		in.SSEKMSKeyId = aws.String(s.kmsKey)
	}
	_, err := s.client.PutObject(ctx, in)
	return err
}

func (s *S3Sink) Get(ctx context.Context, name string) ([]byte, error) {
	r, err := s.client.GetObject(ctx, &s3.GetObjectInput{Bucket: aws.String(s.bucket), Key: aws.String(s.key(name))})
	if err != nil {
		return nil, err
	}
	defer r.Body.Close()
	return io.ReadAll(r.Body)
}

func (s *S3Sink) List(ctx context.Context, prefix string) ([]string, error) {
	var out []string
	p := s3.NewListObjectsV2Paginator(s.client, &s3.ListObjectsV2Input{Bucket: aws.String(s.bucket), Prefix: aws.String(s.key(prefix))})
	for p.HasMorePages() {
		page, err := p.NextPage(ctx)
		if err != nil {
			return nil, err
		}
		for _, o := range page.Contents {
			k := aws.ToString(o.Key)
			if strings.HasSuffix(k, ".mpcbackup") {
				out = append(out, strings.TrimPrefix(strings.TrimPrefix(k, s.prefix), "/"))
			}
		}
	}
	sort.Strings(out)
	return out, nil
}

func (s *S3Sink) Delete(ctx context.Context, name string) error {
	_, err := s.client.DeleteObject(ctx, &s3.DeleteObjectInput{Bucket: aws.String(s.bucket), Key: aws.String(s.key(name))})
	return err
}

var _ = fmt.Sprintf
