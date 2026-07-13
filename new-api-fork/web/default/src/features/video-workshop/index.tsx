import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  Clapperboard,
  Film,
  LoaderCircle,
  RefreshCcw,
  ShieldCheck,
  Sparkles,
  UploadCloud,
  X,
} from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { cn } from '@/lib/utils'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from '@/components/ui/empty'
import { Label } from '@/components/ui/label'
import { Progress } from '@/components/ui/progress'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'
import { SectionPageLayout } from '@/components/layout'
import { createWorkshopVideo, getAllApiKeys } from './api'
import {
  getVideoTokenUnavailableReason,
  getVideoUrl,
  videoModelRequiresReference,
} from './lib'
import {
  VIDEO_MODEL_IDS,
  type VideoDuration,
  type VideoModelId,
  type VideoResolution,
  type VideoTask,
  type VideoWorkshopToken,
} from './types'

const MAX_REFERENCE_BYTES = 20 * 1024 * 1024

export function VideoWorkshop() {
  const { t } = useTranslation()
  const [rawTokens, setRawTokens] = useState<VideoWorkshopToken[]>([])
  const [tokensLoading, setTokensLoading] = useState(true)
  const [selectedTokenId, setSelectedTokenId] = useState('')
  const [model, setModel] = useState<VideoModelId>('MiniMax-Hailuo-2.3')
  const [prompt, setPrompt] = useState('')
  const [duration, setDuration] = useState<VideoDuration>(6)
  const [resolution, setResolution] = useState<VideoResolution>('768P')
  const [referenceImage, setReferenceImage] = useState<File | null>(null)
  const [referencePreview, setReferencePreview] = useState('')
  const [task, setTask] = useState<VideoTask | null>(null)
  const [generating, setGenerating] = useState(false)
  const abortRef = useRef<AbortController | null>(null)
  const fileInputRef = useRef<HTMLInputElement | null>(null)
  const referencePreviewRef = useRef('')

  const loadTokens = useCallback(async () => {
    setTokensLoading(true)
    try {
      const items = await getAllApiKeys()
      setRawTokens(items.map((token) => ({ ...token, usable: true })))
    } catch (error) {
      setRawTokens([])
      toast.error(
        error instanceof Error ? error.message : t('Failed to load API keys')
      )
    } finally {
      setTokensLoading(false)
    }
  }, [t])

  useEffect(() => {
    let active = true
    getAllApiKeys()
      .then((items) => {
        if (active) {
          setRawTokens(items.map((token) => ({ ...token, usable: true })))
        }
      })
      .catch((error: unknown) => {
        if (!active) return
        setRawTokens([])
        toast.error(
          error instanceof Error ? error.message : t('Failed to load API keys')
        )
      })
      .finally(() => {
        if (active) setTokensLoading(false)
      })
    return () => {
      active = false
      abortRef.current?.abort()
      if (referencePreviewRef.current) {
        URL.revokeObjectURL(referencePreviewRef.current)
      }
    }
  }, [t])

  const tokens = useMemo(
    () =>
      rawTokens.map((token) => {
        const unavailableReason = getVideoTokenUnavailableReason(token, model)
        return { ...token, usable: !unavailableReason, unavailableReason }
      }),
    [model, rawTokens]
  )
  const selectedToken = useMemo(
    () => tokens.find((token) => String(token.id) === selectedTokenId),
    [selectedTokenId, tokens]
  )
  const usableTokens = tokens.filter((token) => token.usable)
  const videoUrl = task ? getVideoUrl(task) : undefined
  const referenceRequired = videoModelRequiresReference(model)
  const canGenerate =
    !generating &&
    Boolean(selectedToken?.usable) &&
    prompt.trim().length > 0 &&
    (!referenceRequired || Boolean(referenceImage)) &&
    prompt.length <= 2000

  let tokenSelectLabel = t('Select an API key')
  if (tokensLoading) tokenSelectLabel = t('Loading API keys...')
  if (selectedToken?.usable) tokenSelectLabel = selectedToken.name

  const selectReference = (file?: File) => {
    if (!file) return
    if (!file.type.startsWith('image/')) {
      toast.error(t('Please select an image file'))
      return
    }
    if (file.size > MAX_REFERENCE_BYTES) {
      toast.error(t('Reference image must be smaller than 20 MB'))
      return
    }
    if (referencePreviewRef.current) {
      URL.revokeObjectURL(referencePreviewRef.current)
    }
    const preview = URL.createObjectURL(file)
    referencePreviewRef.current = preview
    setReferenceImage(file)
    setReferencePreview(preview)
  }

  const removeReference = () => {
    if (referencePreviewRef.current) {
      URL.revokeObjectURL(referencePreviewRef.current)
      referencePreviewRef.current = ''
    }
    setReferenceImage(null)
    setReferencePreview('')
    if (fileInputRef.current) fileInputRef.current.value = ''
  }

  const generate = async () => {
    if (!canGenerate || !selectedToken) return
    const controller = new AbortController()
    abortRef.current = controller
    setGenerating(true)
    setTask(null)
    try {
      const result = await createWorkshopVideo(
        {
          tokenId: selectedToken.id,
          model,
          prompt,
          duration,
          resolution,
          referenceImage,
        },
        setTask,
        controller.signal
      )
      setTask(result)
      toast.success(t('Video generated'))
    } catch (error) {
      if (controller.signal.aborted) toast.message(t('Generation cancelled'))
      else {
        toast.error(
          error instanceof Error ? error.message : t('Video generation failed')
        )
      }
    } finally {
      if (abortRef.current === controller) abortRef.current = null
      setGenerating(false)
    }
  }

  return (
    <SectionPageLayout>
      <SectionPageLayout.Title>{t('Video Workshop')}</SectionPageLayout.Title>
      <SectionPageLayout.Actions>
        <div className='flex items-center gap-2'>
          <Badge variant='secondary' className='gap-1.5'>
            <ShieldCheck className='size-3.5' />
            {t('Keys stay in this session')}
          </Badge>
          <Badge variant='outline' className='gap-1.5'>
            <Sparkles className='size-3.5' />
            {t('Beta')}
          </Badge>
        </div>
      </SectionPageLayout.Actions>
      <SectionPageLayout.Content>
        <div className='grid min-h-full gap-3 lg:grid-cols-[minmax(19rem,24rem)_minmax(0,1fr)]'>
          <Card className='h-fit gap-0 overflow-hidden py-0'>
            <CardHeader className='border-b p-4'>
              <CardTitle className='flex items-center gap-2 text-base'>
                <Clapperboard className='text-primary size-4' />
                {t('Video controls')}
              </CardTitle>
              <CardDescription>
                {t('Create a video from text or animate a reference image.')}
              </CardDescription>
            </CardHeader>
            <CardContent className='space-y-5 p-4'>
              <div className='grid gap-3 sm:grid-cols-2 lg:grid-cols-1 xl:grid-cols-2'>
                <div className='space-y-1.5'>
                  <div className='flex items-center justify-between gap-2'>
                    <Label htmlFor='video-token'>{t('API Key')}</Label>
                    <Button
                      type='button'
                      variant='ghost'
                      size='icon-xs'
                      disabled={tokensLoading}
                      aria-label={t('Refresh API keys')}
                      onClick={() => void loadTokens()}
                    >
                      <RefreshCcw
                        className={cn(
                          'size-3.5',
                          tokensLoading && 'animate-spin'
                        )}
                      />
                    </Button>
                  </div>
                  <Select
                    value={selectedToken?.usable ? selectedTokenId : ''}
                    onValueChange={(value) => setSelectedTokenId(String(value))}
                    disabled={tokensLoading || tokens.length === 0}
                  >
                    <SelectTrigger id='video-token' className='h-9 w-full'>
                      <SelectValue>{tokenSelectLabel}</SelectValue>
                    </SelectTrigger>
                    <SelectContent>
                      {tokens.map((token) => (
                        <SelectItem
                          key={token.id}
                          value={String(token.id)}
                          disabled={!token.usable}
                        >
                          <span className='flex min-w-0 flex-col'>
                            <span className='truncate'>{token.name}</span>
                            {token.unavailableReason && (
                              <span className='text-muted-foreground text-[11px]'>
                                {token.unavailableReason}
                              </span>
                            )}
                          </span>
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className='space-y-1.5'>
                  <Label htmlFor='video-model'>{t('Model')}</Label>
                  <Select
                    value={model}
                    onValueChange={(value) => setModel(value as VideoModelId)}
                  >
                    <SelectTrigger id='video-model' className='h-9 w-full'>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {VIDEO_MODEL_IDS.map((item) => (
                        <SelectItem key={item} value={item}>
                          {item}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>

              {!tokensLoading && usableTokens.length === 0 && (
                <Alert className='border-amber-500/30 bg-amber-500/10'>
                  <AlertDescription>
                    {t('No enabled API key can access this video model.')}
                  </AlertDescription>
                </Alert>
              )}

              {referenceRequired && !referenceImage && (
                <Alert className='border-blue-500/30 bg-blue-500/10'>
                  <AlertDescription>
                    {t('The Fast model requires a first-frame image.')}
                  </AlertDescription>
                </Alert>
              )}

              <div className='space-y-1.5'>
                <div className='flex items-center justify-between gap-2'>
                  <Label htmlFor='video-prompt'>{t('Prompt')}</Label>
                  <span className='text-muted-foreground text-[11px] tabular-nums'>
                    {prompt.length.toLocaleString()} / 2,000
                  </span>
                </div>
                <Textarea
                  id='video-prompt'
                  value={prompt}
                  maxLength={2000}
                  onChange={(event) => setPrompt(event.target.value)}
                  placeholder={t(
                    'Describe the scene, movement, camera and atmosphere.'
                  )}
                  className='min-h-36 resize-y leading-relaxed'
                />
              </div>

              <div className='grid grid-cols-2 gap-3'>
                <div className='space-y-1.5'>
                  <Label htmlFor='video-duration'>{t('Duration')}</Label>
                  <Select
                    value={String(duration)}
                    onValueChange={(value) =>
                      setDuration(Number(value) as VideoDuration)
                    }
                  >
                    <SelectTrigger id='video-duration' className='h-9 w-full'>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value='6'>6 {t('seconds')}</SelectItem>
                      <SelectItem value='10'>10 {t('seconds')}</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className='space-y-1.5'>
                  <Label htmlFor='video-resolution'>{t('Resolution')}</Label>
                  <Select
                    value={resolution}
                    onValueChange={(value) =>
                      setResolution(value as VideoResolution)
                    }
                  >
                    <SelectTrigger id='video-resolution' className='h-9 w-full'>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value='768P'>768P</SelectItem>
                      <SelectItem value='1080P'>1080P</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>

              <div className='space-y-2'>
                <div className='flex items-center justify-between gap-2'>
                  <Label>{t('First frame')}</Label>
                  <span className='text-muted-foreground text-[11px]'>
                    {t('Optional · max 20 MB')}
                  </span>
                </div>
                <input
                  ref={fileInputRef}
                  type='file'
                  accept='image/*'
                  className='sr-only'
                  onChange={(event) => selectReference(event.target.files?.[0])}
                />
                {referenceImage && referencePreview ? (
                  <div className='bg-muted/30 relative flex items-center gap-3 rounded-xl border p-2'>
                    <img
                      src={referencePreview}
                      alt={t('Reference preview')}
                      className='size-16 rounded-lg object-cover'
                    />
                    <div className='min-w-0 flex-1'>
                      <p className='truncate text-sm font-medium'>
                        {referenceImage.name}
                      </p>
                      <p className='text-muted-foreground text-xs'>
                        {(referenceImage.size / 1024 / 1024).toFixed(2)} MB ·{' '}
                        {t('Image-to-video mode')}
                      </p>
                    </div>
                    <Button
                      type='button'
                      size='icon-sm'
                      variant='ghost'
                      aria-label={t('Remove reference image')}
                      onClick={removeReference}
                    >
                      <X className='size-4' />
                    </Button>
                  </div>
                ) : (
                  <button
                    type='button'
                    onClick={() => fileInputRef.current?.click()}
                    className='border-border hover:bg-muted/40 focus-visible:ring-ring flex w-full items-center justify-center gap-3 rounded-xl border border-dashed px-4 py-5 text-left transition-colors outline-none focus-visible:ring-2'
                  >
                    <span className='bg-muted flex size-9 items-center justify-center rounded-lg'>
                      <UploadCloud className='text-muted-foreground size-4' />
                    </span>
                    <span>
                      <span className='block text-sm font-medium'>
                        {t('Add a first frame')}
                      </span>
                      <span className='text-muted-foreground block text-xs'>
                        {t('Leave empty for text-to-video.')}
                      </span>
                    </span>
                  </button>
                )}
              </div>

              <div className='flex gap-2'>
                <Button
                  type='button'
                  className='h-10 flex-1 gap-2'
                  disabled={!canGenerate}
                  onClick={() => void generate()}
                >
                  {generating ? (
                    <LoaderCircle className='size-4 animate-spin' />
                  ) : (
                    <Film className='size-4' />
                  )}
                  {generating
                    ? t('Generating video...')
                    : t('Start generating')}
                </Button>
                {generating && (
                  <Button
                    type='button'
                    variant='outline'
                    className='h-10'
                    onClick={() => abortRef.current?.abort()}
                  >
                    {t('Cancel')}
                  </Button>
                )}
              </div>
            </CardContent>
          </Card>

          <Card className='min-h-[36rem] gap-0 overflow-hidden py-0'>
            <CardHeader className='border-b p-4'>
              <CardTitle className='text-base'>{t('Video result')}</CardTitle>
              <CardDescription>
                {t(
                  'Video tasks can take several minutes. Keep this page open.'
                )}
              </CardDescription>
            </CardHeader>
            <CardContent className='flex min-h-[31rem] flex-col p-4'>
              {task && generating ? (
                <div className='m-auto w-full max-w-lg space-y-5 text-center'>
                  <span className='bg-primary/10 mx-auto flex size-14 items-center justify-center rounded-2xl'>
                    <LoaderCircle className='text-primary size-7 animate-spin' />
                  </span>
                  <div>
                    <p className='font-medium'>{t('Generating video')}</p>
                    <p className='text-muted-foreground mt-1 text-sm'>
                      {t('Status')}: {task.status} · {task.progress ?? 0}%
                    </p>
                  </div>
                  <Progress value={task.progress ?? 0} />
                  <p className='text-muted-foreground text-xs'>ID: {task.id}</p>
                </div>
              ) : videoUrl ? (
                <div className='flex flex-1 flex-col gap-4'>
                  <video
                    src={videoUrl}
                    controls
                    playsInline
                    className='bg-muted aspect-video max-h-[70vh] w-full rounded-xl object-contain'
                  />
                  <div className='flex flex-wrap items-center justify-between gap-3'>
                    <div>
                      <p className='text-sm font-medium'>
                        {t('Video generated')}
                      </p>
                      <p className='text-muted-foreground text-xs'>
                        {task?.model || model} · {duration}s · {resolution}
                      </p>
                    </div>
                    <Button asChild variant='outline'>
                      <a href={videoUrl} download rel='noopener'>
                        {t('Download video')}
                      </a>
                    </Button>
                  </div>
                </div>
              ) : (
                <Empty className='m-auto'>
                  <EmptyHeader>
                    <EmptyMedia variant='icon'>
                      <Film />
                    </EmptyMedia>
                    <EmptyTitle>{t('Your video canvas is ready')}</EmptyTitle>
                    <EmptyDescription>
                      {t(
                        'Choose an API key, write a prompt and start generating.'
                      )}
                    </EmptyDescription>
                  </EmptyHeader>
                </Empty>
              )}
            </CardContent>
          </Card>
        </div>
      </SectionPageLayout.Content>
    </SectionPageLayout>
  )
}
